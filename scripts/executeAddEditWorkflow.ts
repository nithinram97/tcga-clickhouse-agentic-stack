import { createEditBatch, Edits, Integer, Long } from "@osdk/functions";
import { Client } from "@osdk/client";
import {
    ErmDashboardUserInput, ErmDashboardUserInputDev,
    ErmRiskUserInput, ErmRiskUserInputDev,
    ErmDashboardRiskAndOpportunity, ErmDashboardMitigation,
    ErmDashboardWaterfall, ErmCockpitUser,
    ErmRisksSharingEdits, ErmRisksSharingEditsDev
} from "@ontology/sdk";

/**
 * Dashboard create / edit lifecycle.
 *
 *   add               V1.1 of a new family (from scratch or "report based on")
 *   edit              update an unlocked dashboard; on a locked one only permissions change
 *   create_iteration  locked Vx.y  -> new Vx.(y+1)   (source stays untouched)
 *   duplicate         Vx.y         -> new V(x+1).1
 *
 * Differences from the previous version:
 *  - Authorisation uses the STORED dashboard roles, never the permission lists sent by the caller
 *    (before, a caller could put themselves in permissionsOwnerNames and pass the check, and
 *    readers were allowed to edit).
 *  - Edit / duplicate / iteration fail loudly when the dashboard is not found, and creation fails
 *    when the target V x.y already exists (no silent no-op, no duplicate primary key).
 *  - Locked dashboards: no perimeter / risk-record changes, only permissions (owners / officers).
 *  - All queries page through every result (fetchPage only returned the first page) and large
 *    $in filters are chunked.
 *  - Officers are looked up only for the dashboard's siglums.
 *  - The "rescue" of permissions granted by other dashboards' sharings is applied per risk
 *    instead of globally.
 */

type WorkflowEdits =
    | Edits.Object<ErmDashboardUserInput>
    | Edits.Object<ErmDashboardUserInputDev>
    | Edits.Object<ErmRiskUserInput>
    | Edits.Object<ErmRiskUserInputDev>
    | Edits.Object<ErmDashboardRiskAndOpportunity>
    | Edits.Object<ErmDashboardMitigation>
    | Edits.Object<ErmDashboardWaterfall>;

type ActionType = "add" | "edit" | "duplicate" | "create_iteration";
const CREATION_ACTIONS: ActionType[] = ["add", "duplicate", "create_iteration"];
const IN_CHUNK = 500;

/**
 * Officer siglums on ErmCockpitUser (there is no "siglum" property).
 * An officer covers a dashboard when one of the dashboard's siglums
 *   - equals their 1-letter or 2-letter siglum (e.g. "H" or "HQ"), or
 *   - is a sub-siglum of their 2-letter siglum (e.g. "HQX" under "HQ") when OFFICER_COVERS_SUB_SIGLUMS.
 */
const OFFICER_SIGLUM_1 = "userSiglum1letter";
const OFFICER_SIGLUM_2 = "userSiglum2letter";
const OFFICER_COVERS_SUB_SIGLUMS = true;

const norm = (v: unknown): string => (typeof v === "string" ? v.trim().toUpperCase() : "");

function officerCoversSiglum(user: any, siglum: string): boolean {
    const target = norm(siglum);
    if (!target) return false;
    const s1 = norm(user?.[OFFICER_SIGLUM_1]);
    const s2 = norm(user?.[OFFICER_SIGLUM_2]);
    if (target === s1 || target === s2) return true;
    return OFFICER_COVERS_SUB_SIGLUMS && s2.length === 2 && target.startsWith(s2);
}

const lower = (list: readonly (string | undefined | null)[] | undefined): string[] =>
    (list || []).filter((s): s is string => Boolean(s)).map(s => s.trim().toLowerCase());

const toIso = (epoch: Long | number | string | undefined): string | undefined => {
    if (epoch === undefined || epoch === null || epoch === "") return undefined;
    const n = Number(epoch);
    return !isNaN(n) && n > 0 ? new Date(n).toISOString() : String(epoch);
};

function chunk<T>(list: T[], size = IN_CHUNK): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

/** Reads every page of a query (fetchPage alone silently stops after the first page). */
async function fetchAll(query: any): Promise<any[]> {
    const out: any[] = [];
    for await (const obj of query.asyncIter()) out.push(obj);
    return out;
}

/** fetchAll with a chunked `$in` filter on one property. */
async function fetchAllIn(client: Client, type: any, prop: string, values: unknown[], extraWhere: Record<string, unknown> = {}): Promise<any[]> {
    if (values.length === 0) return [];
    const parts = await Promise.all(
        chunk(values).map(part => fetchAll(client(type).where({ ...extraWhere, [prop]: { $in: part } })))
    );
    return parts.flat();
}

/**
 * Same lookup as the previous (working) implementation: filter on version / iteration server-side,
 * compare creationDate in memory (works whether it is stored as a timestamp or an ISO string).
 * All pages are read, so the match is not missed when many dashboards share V1.1.
 */
async function findDashboard(client: Client, type: any, creationDateIso: string, version: number, iteration: number): Promise<any | undefined> {
    const targetMs = new Date(creationDateIso).getTime();
    const candidates = await fetchAll(client(type).where({ boardVersion: version, boardIteration: iteration }));
    return candidates.find((d: any) => d.creationDate && new Date(d.creationDate).getTime() === targetMs);
}

function cascadePermissions(currentList: string[] | undefined, toAdd: string[], toRemove: Set<string>): string[] {
    const keep = (currentList || []).filter(name => !toRemove.has(name.trim().toLowerCase()));
    const seen = new Set(keep.map(n => n.trim().toLowerCase()));
    return [...keep, ...toAdd.filter(n => !seen.has(n.trim().toLowerCase()))];
}

export default async function executeAddEditWorkflow(
    client: Client,
    userMail: string,
    actionType: string, // "add" | "edit" | "duplicate" | "create_iteration"
    env: string,
    creationDate: Long,
    boardVersion: Integer,
    boardIteration: Integer,
    ownerDashboard: string[],
    pkImpactIdList: Integer[],
    actionList: string[],
    permissionsToAdd: string[],
    permissionsToRemove: string[],
    permissionsReadNames: string[],
    permissionsWriteNames: string[],
    permissionsOwnerNames: string[],
    boardTitle?: string,
    boardStatus?: string,
    reportType?: string,
    settings?: string,
    editableUntil?: Long,
    validation?: boolean,
    creationDateBasedOn?: Long,
    boardVersionBasedOn?: Integer,
    boardIterationBasedOn?: Integer
): Promise<WorkflowEdits[]> {

    const action = actionType as ActionType;
    const targetDashboardId = `${creationDate}___${boardVersion}___${boardIteration}`;
    console.info("Workflow Initialized", { action: "executeAddEditWorkflow", userMail, actionType, env, targetDashboardId });

    try {
        if (![...CREATION_ACTIONS, "edit"].includes(action)) {
            throw new Error(`Unsupported actionType "${actionType}".`);
        }

        const isMaster = env === "master";
        const isCreation = CREATION_ACTIONS.includes(action);
        const now = new Date().toISOString();
        const me = userMail.trim().toLowerCase();
        const batch = createEditBatch<WorkflowEdits>(client);

        const TargetDashboardType: any = isMaster ? ErmDashboardUserInput : ErmDashboardUserInputDev;
        const TargetRiskType: any = isMaster ? ErmRiskUserInput : ErmRiskUserInputDev;
        const TargetSharingType: any = isMaster ? ErmRisksSharingEdits : ErmRisksSharingEditsDev;

        const creationDateIso = toIso(creationDate)!;
        const version = Number(boardVersion);
        const iteration = Number(boardIteration);
        const pkList = (pkImpactIdList || []).map(Number).filter(n => !isNaN(n) && n > 0);

        // ==========================================
        // PHASE 1: LOAD STORED STATE
        // ==========================================
        const [targetBoard, sourceBoard] = await Promise.all([
            findDashboard(client, TargetDashboardType, creationDateIso, version, iteration),
            (action === "duplicate" || action === "create_iteration") && creationDateBasedOn
                ? findDashboard(client, TargetDashboardType, toIso(creationDateBasedOn)!, Number(boardVersionBasedOn), Number(boardIterationBasedOn))
                : Promise.resolve(undefined),
        ]);

        if (action === "edit" && !targetBoard) {
            throw new Error(`Dashboard ${targetDashboardId} was not found; it may have been deleted or its identity changed. Please reload.`);
        }
        if (isCreation && targetBoard) {
            throw new Error(`Dashboard V${version}.${iteration} already exists. Please reload the list and try again.`);
        }
        if (action === "duplicate" || action === "create_iteration") {
            if (!sourceBoard) throw new Error("The source dashboard for this new version / iteration was not found.");
            if (toIso(creationDateBasedOn) !== creationDateIso) {
                throw new Error("A new version or iteration must stay in the same dashboard family (same creation date).");
            }
            if (action === "create_iteration" && Number(boardVersionBasedOn) !== version) {
                throw new Error("A new iteration must keep the same major version.");
            }
            if (action === "duplicate" && version <= Number(boardVersionBasedOn)) {
                throw new Error("A new version must have a higher version number than its source.");
            }
        }

        // Officers: stored ones + officers of the (stored, or requested for new dashboards) siglums.
        const roleSource = action === "edit" ? targetBoard : sourceBoard;
        const siglums = Array.from(new Set([...(ownerDashboard || []), ...((roleSource?.ownerDashboard as string[]) || [])]));
        // Only filter server-side on userAppProfile (known to exist); match siglums in memory.
        const officerUsers = siglums.length > 0
            ? await fetchAll(client(ErmCockpitUser).where({ userAppProfile: "Officer" }))
            : [];
        const officersFor = (wanted: string[]) =>
            officerUsers
                .filter((u: any) => wanted.some(sg => officerCoversSiglum(u, sg)))
                .map((u: any) => u.userIdentifier as string)
                .filter(Boolean);
        const officersForRequestedSiglums = officersFor(ownerDashboard || []);
        const officersForStoredSiglums = officersFor((roleSource?.ownerDashboard as string[]) || []);

        // ==========================================
        // PHASE 2: AUTHORISATION (from STORED roles)
        // ==========================================
        const storedOwners = lower(roleSource?.permissionsOwnerNames);
        const storedWriters = lower(roleSource?.permissionsWriteNames);
        const storedOfficers = lower([...(roleSource?.permissionsOfficerNames || []), ...officersForStoredSiglums]);

        const isOfficer = storedOfficers.includes(me);
        const isOwner = storedOwners.includes(me);
        const isWriter = storedWriters.includes(me);

        let dashboardLocked = false;
        if (action === "edit") {
            const pastDeadline = targetBoard.editableUntil && new Date(targetBoard.editableUntil).getTime() < Date.now();
            dashboardLocked = Boolean(targetBoard.validation) || Boolean(pastDeadline);

            if (!isOfficer && !isOwner && !isWriter) {
                throw new Error("Insufficient permissions: only writers, owners and officers can edit this dashboard.");
            }
            if (dashboardLocked && !isOfficer && !isOwner) {
                throw new Error("This dashboard is validated / locked. Ask an owner to create a new iteration.");
            }
        } else if (action === "duplicate" || action === "create_iteration") {
            if (!isOfficer && !isOwner) {
                throw new Error("Insufficient permissions: you must be an Owner or Officer to create a new version or iteration of this dashboard.");
            }
        }
        // "add": anyone may create a dashboard; they become its owner.

        const canSetReadWrite = isCreation || isOfficer || isOwner;
        const canSetOwners = isCreation || isOfficer;

        // Final role lists written to dashboard + risk records
        const finalReaders = canSetReadWrite ? permissionsReadNames : (targetBoard?.permissionsReadNames || []);
        const finalWriters = canSetReadWrite ? permissionsWriteNames : (targetBoard?.permissionsWriteNames || []);
        let finalOwners: string[] = canSetOwners ? permissionsOwnerNames : (targetBoard?.permissionsOwnerNames || []);
        if (isCreation && !lower(finalOwners).includes(me)) finalOwners = [...finalOwners, userMail];
        const finalOfficers = dashboardLocked
            ? Array.from(new Set([...(targetBoard?.permissionsOfficerNames || []), ...officersForRequestedSiglums]))
            : officersForRequestedSiglums;

        // ==========================================
        // PHASE 3: DASHBOARD RECORD
        // ==========================================
        const dashboardProperties: any = {
            permissionsOfficerNames: finalOfficers,
            updatedOn: now,
        };
        if (canSetReadWrite) {
            dashboardProperties.permissionsReadNames = finalReaders;
            dashboardProperties.permissionsWriteNames = finalWriters;
        }
        if (canSetOwners) dashboardProperties.permissionsOwnerNames = finalOwners;

        if (!dashboardLocked) {
            dashboardProperties.boardTitle = boardTitle;
            dashboardProperties.boardStatus = isCreation ? "Active" : (boardStatus || "Active");
            dashboardProperties.reportType = reportType || "Report";
            dashboardProperties.settings = settings;
            dashboardProperties.ownerDashboard = ownerDashboard;
            dashboardProperties.pkImpactIdList = pkList;
            if (editableUntil) dashboardProperties.editableUntil = toIso(editableUntil);
        }

        if (isCreation) {
            Object.assign(dashboardProperties, {
                dashboardId: targetDashboardId,
                creationDate: creationDateIso,
                boardVersion: version,
                boardIteration: iteration,
                validation: false, // new V1.1 / iteration / version always starts unlocked
                permissionsReadNames: finalReaders,
                permissionsWriteNames: finalWriters,
                permissionsOwnerNames: finalOwners,
            });
            batch.create(TargetDashboardType, dashboardProperties);
        } else {
            batch.update(targetBoard, dashboardProperties);
        }

        if (pkList.length === 0) return batch.getEdits();

        // ==========================================
        // PHASE 4: PERMISSION CASCADE (with per-risk rescue)
        // ==========================================
        const toAdd = canSetReadWrite ? (permissionsToAdd || []) : [];
        const toRemove = canSetReadWrite ? lower(permissionsToRemove) : [];
        const hasPermissionChanges = toAdd.length > 0 || toRemove.length > 0;
        const strPkList = pkList.map(String);

        const [matchingRo, mitigations, waterfalls, existingInputRisks, sourceInputRisks, sharings] = await Promise.all([
            fetchAllIn(client, ErmDashboardRiskAndOpportunity, "pkImpactId", pkList),
            hasPermissionChanges ? fetchAllIn(client, ErmDashboardMitigation, "pkImpactIdAsString", strPkList) : Promise.resolve([]),
            hasPermissionChanges ? fetchAllIn(client, ErmDashboardWaterfall, "pkImpactIdAsString", strPkList) : Promise.resolve([]),
            isCreation
                ? Promise.resolve([]) // brand-new target: no records yet
                : fetchAllIn(client, TargetRiskType, "pkImpactId", pkList, {
                    dashboardCreationDate: creationDateIso,
                    boardVersion: version,
                    boardIteration: iteration,
                }),
            (action === "duplicate" || action === "create_iteration")
                ? fetchAllIn(client, TargetRiskType, "pkImpactId", pkList, {
                    dashboardCreationDate: toIso(creationDateBasedOn),
                    boardVersion: Number(boardVersionBasedOn),
                    boardIteration: Number(boardIterationBasedOn),
                })
                : Promise.resolve([]),
            toRemove.length > 0 ? fetchAllIn(client, TargetSharingType, "pkImpactId", pkList) : Promise.resolve([]),
        ]);

        // A user keeps read access to a risk when another dashboard shared it with them.
        const protectedByPk = new Map<string, Set<string>>();
        sharings.forEach((share: any) => {
            if (share.dashboardFrom === targetDashboardId) return;
            const set = protectedByPk.get(String(share.pkImpactId)) || new Set<string>();
            lower(share.destinator).forEach(d => set.add(d));
            protectedByPk.set(String(share.pkImpactId), set);
        });
        const removalFor = (pk: unknown) => {
            const keep = protectedByPk.get(String(pk));
            return new Set(keep ? toRemove.filter(u => !keep.has(u)) : toRemove);
        };
        const readField = isMaster ? "permissionsReadNames" : "permissionsReadNamesDev";

        if (hasPermissionChanges) {
            const cascade = (obj: any, pk: unknown) =>
                batch.update(obj, { [readField]: cascadePermissions(obj[readField], toAdd, removalFor(pk)) } as any);
            matchingRo.forEach((ro: any) => cascade(ro, ro.pkImpactId));
            mitigations.forEach((m: any) => cascade(m, m.pkImpactIdAsString));
            waterfalls.forEach((w: any) => cascade(w, w.pkImpactIdAsString));
        }

        // ==========================================
        // PHASE 5: PER-DASHBOARD RISK RECORDS
        // ==========================================
        const existingByPk = new Map<number, any>(existingInputRisks.filter((r: any) => r.pkImpactId).map((r: any) => [Number(r.pkImpactId), r]));
        const sourceByPk = new Map<number, any>(sourceInputRisks.filter((r: any) => r.pkImpactId).map((r: any) => [Number(r.pkImpactId), r]));

        matchingRo.forEach((ro: any) => {
            const pk = Number(ro.pkImpactId);
            const existing = existingByPk.get(pk);

            // Locked dashboard: never add risks, only refresh permissions on the existing records.
            if (dashboardLocked && !existing) return;

            const riskProperties: any = { permissionsOfficerNames: finalOfficers };
            if (canSetReadWrite) {
                riskProperties.permissionsReadNames = finalReaders;
                riskProperties.permissionsWriteNames = finalWriters;
            }
            if (canSetOwners) riskProperties.permissionsOwnerNames = finalOwners;

            if (!dashboardLocked) {
                riskProperties.riskTitle = ro.riskTitle;
                riskProperties.riskScore = ro.currentCriticality;
                riskProperties.riskDescription = ro.riskDescription;
                riskProperties.updatedOn = now;

                const idx = pkList.indexOf(pk);
                const act = idx !== -1 ? actionList?.[idx] : undefined;
                if (act?.includes("escalation")) riskProperties.riskToprisk = 1;
                else if (act?.includes("child")) riskProperties.riskParent = Number(act.split("___")[1]);
            }

            // New version / iteration inherits the per-dashboard user edits of its source
            const src = sourceByPk.get(pk);
            if (src) {
                riskProperties.riskComment = src.riskComment;
                riskProperties.statusHeader = src.statusHeader;
                riskProperties.escalatedBy = src.escalatedBy;
                riskProperties.escalatedStatus = src.escalatedStatus;
                riskProperties.riskToprisk = src.riskToprisk;
                riskProperties.riskParent = src.riskParent;
            }

            if (existing) {
                batch.update(existing, riskProperties);
            } else {
                const newRiskId = `${creationDate}_${version}_${iteration}_${pk}`;
                Object.assign(riskProperties, {
                    riskObjectId: newRiskId,
                    riskId: newRiskId,
                    pkImpactId: pk,
                    dashboardCreationDate: creationDateIso,
                    boardVersion: version,
                    boardIteration: iteration,
                    permissionsReadNames: finalReaders,
                    permissionsWriteNames: finalWriters,
                    permissionsOwnerNames: finalOwners,
                });
                batch.create(TargetRiskType, riskProperties);
            }
        });

        // Risks removed from the perimeter keep their per-dashboard record (comments survive a re-add);
        // the dashboard's pkImpactIdList is what defines the perimeter.
        return batch.getEdits();

    } catch (error: any) {
        console.error("FATAL ERROR: Workflow Execution Failed", {
            errorName: error?.name,
            errorMessage: error?.message,
            stack: error?.stack,
        });
        throw error;
    }
}

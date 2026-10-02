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
 *  - ARM read access (R&O, mitigations, waterfalls) is derived on the server from STORED vs FINAL
 *    state instead of the caller's permissionsToAdd / permissionsToRemove:
 *      new risks      -> every final member (readers, writers, owners, officers) gets access
 *      kept risks     -> added members get access, removed members lose it
 *      dropped risks  -> every previous member loses it
 *    so creating a board, adding risks (dialog or Full Search), removing risks and officer
 *    changes now share / revoke like the Slate app did. permissionsToAdd / permissionsToRemove
 *    are kept in the signature for client compatibility but are no longer used.
 *  - Revocations are "rescued" per risk for users who still get access through another dashboard
 *    containing that risk (any of its roles) or through an explicit sharing / escalation.
 *    Both lookups run as the calling user, so dashboards and sharings hidden from them by the
 *    restricted views cannot rescue (same limit as the Slate app).
 *  - Only risks the caller can read are added to the perimeter; stored risks the caller cannot
 *    see are kept untouched (they could not have been removed knowingly from the client).
 *  - Locked dashboards keep their stored perimeter; only permissions change.
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

/** Dashboards in these statuses no longer grant access to their risks. */
const NON_GRANTING_STATUSES = ["deleted"];

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

const uniqLower = (list: readonly (string | undefined | null)[] | undefined): string[] =>
    Array.from(new Set(lower(list)));

const toIso = (epoch: Long | number | string | undefined): string | undefined => {
    if (epoch === undefined || epoch === null || epoch === "") return undefined;
    const n = Number(epoch);
    return !isNaN(n) && n > 0 ? new Date(n).toISOString() : String(epoch);
};

const toPkList = (list: readonly unknown[] | undefined): number[] =>
    Array.from(new Set((list || []).map(Number).filter(n => !isNaN(n) && n > 0)));

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
 */
async function findDashboard(client: Client, type: any, creationDateIso: string, version: number, iteration: number): Promise<any | undefined> {
    const targetMs = new Date(creationDateIso).getTime();
    const candidates = await fetchAll(client(type).where({ boardVersion: version, boardIteration: iteration }));
    return candidates.find((d: any) => d.creationDate && new Date(d.creationDate).getTime() === targetMs);
}

/** Every user holding a role on a dashboard (lower-cased). */
function dashboardMembers(board: any, extraOfficers: string[] = []): string[] {
    if (!board) return uniqLower(extraOfficers);
    return uniqLower([
        ...(board.permissionsReadNames || []),
        ...(board.permissionsWriteNames || []),
        ...(board.permissionsOwnerNames || []),
        ...(board.permissionsOfficerNames || []),
        ...extraOfficers,
    ]);
}

/** Applies additions / removals to a read list, case-insensitively, keeping the stored casing. */
function applyAccess(currentList: string[] | undefined, toAdd: string[], toRemove: Set<string>): string[] {
    const keep = (currentList || []).filter(name => !toRemove.has(name.trim().toLowerCase()));
    const seen = new Set(keep.map(n => n.trim().toLowerCase()));
    const added: string[] = [];
    toAdd.forEach(n => {
        const key = n.trim().toLowerCase();
        if (key && !seen.has(key)) {
            seen.add(key);
            added.push(n.trim());
        }
    });
    return [...keep, ...added];
}

const sameMembers = (a: string[] | undefined, b: string[]): boolean => {
    const la = uniqLower(a), lb = uniqLower(b);
    return la.length === lb.length && la.every(x => lb.includes(x));
};

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
    permissionsToAdd: string[],     // no longer used: access is derived on the server (kept for client compatibility)
    permissionsToRemove: string[],  // no longer used: access is derived on the server (kept for client compatibility)
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
        const readField = isMaster ? "permissionsReadNames" : "permissionsReadNamesDev";

        const creationDateIso = toIso(creationDate)!;
        const version = Number(boardVersion);
        const iteration = Number(boardIteration);
        const requestedPks = toPkList(pkImpactIdList);

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
        // PHASE 3: PERIMETER (what risks the board holds, before vs after)
        // ==========================================
        // Baseline = the stored target (edit) or the source board (new version / iteration).
        // A brand-new board ("add") starts empty, so every risk and every member is "new".
        const baselineBoard = action === "edit" ? targetBoard : (action === "add" ? undefined : sourceBoard);
        const storedPks = toPkList(baselineBoard?.pkImpactIdList);

        // Locked dashboards cannot change perimeter.
        const wantedPks = dashboardLocked ? storedPks : requestedPks;

        // R&O rows for everything we may touch. The objects are restricted views and this function
        // runs as the caller, so only risks the caller can read come back.
        const candidatePks = Array.from(new Set([...wantedPks, ...storedPks]));
        const roRows = await fetchAllIn(client, ErmDashboardRiskAndOpportunity, "pkImpactId", candidatePks);
        const visiblePks = new Set(roRows.map((ro: any) => Number(ro.pkImpactId)));

        // Final perimeter: requested risks the caller can read + stored risks hidden from the caller
        // (the client never showed them, so they cannot have been removed on purpose).
        const finalPks = Array.from(new Set([
            ...wantedPks.filter(pk => visiblePks.has(pk)),
            ...storedPks.filter(pk => !visiblePks.has(pk)),
        ]));
        const finalPkSet = new Set(finalPks);
        const storedPkSet = new Set(storedPks);
        const newPks = finalPks.filter(pk => !storedPkSet.has(pk) && visiblePks.has(pk));
        const keptPks = finalPks.filter(pk => storedPkSet.has(pk) && visiblePks.has(pk));
        const droppedPks = storedPks.filter(pk => !finalPkSet.has(pk) && visiblePks.has(pk));

        // ==========================================
        // PHASE 4: DASHBOARD RECORD
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
            dashboardProperties.pkImpactIdList = finalPks;
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

        // ==========================================
        // PHASE 5: ARM READ ACCESS (derived from stored vs final state)
        // ==========================================
        const membersBefore = baselineBoard
            ? dashboardMembers(baselineBoard, action === "edit" ? [] : officersForStoredSiglums)
            : [];
        const membersAfter = uniqLower([...finalReaders, ...finalWriters, ...finalOwners, ...finalOfficers]);
        const addedMembers = membersAfter.filter(u => !membersBefore.includes(u));
        const removedMembers = membersBefore.filter(u => !membersAfter.includes(u));

        // Per risk: who gains access, who loses it.
        const grantFor = new Map<number, string[]>();
        const revokeFor = new Map<number, string[]>();
        newPks.forEach(pk => grantFor.set(pk, membersAfter));
        keptPks.forEach(pk => {
            if (addedMembers.length) grantFor.set(pk, addedMembers);
            if (removedMembers.length) revokeFor.set(pk, removedMembers);
        });
        droppedPks.forEach(pk => revokeFor.set(pk, membersBefore));

        const touchedPks = Array.from(new Set([...grantFor.keys(), ...revokeFor.keys()]));
        const revokePks = Array.from(revokeFor.keys());
        const strTouched = touchedPks.map(String);

        const [mitigations, waterfalls, sharings, otherBoards] = await Promise.all([
            fetchAllIn(client, ErmDashboardMitigation, "pkImpactIdAsString", strTouched),
            fetchAllIn(client, ErmDashboardWaterfall, "pkImpactIdAsString", strTouched),
            revokePks.length ? fetchAllIn(client, TargetSharingType, "pkImpactId", revokePks) : Promise.resolve([]),
            // Every dashboard the caller can see; used to keep access granted through another board.
            revokePks.length ? fetchAll(client(TargetDashboardType)) : Promise.resolve([]),
        ]);

        // Rescue: users who keep read access to a risk through another dashboard or an explicit share.
        const protectedByPk = new Map<number, Set<string>>();
        const protect = (pk: unknown, users: string[]) => {
            const key = Number(pk);
            if (!revokeFor.has(key)) return;
            const set = protectedByPk.get(key) || new Set<string>();
            users.forEach(u => set.add(u));
            protectedByPk.set(key, set);
        };
        sharings.forEach((share: any) => {
            if (share.dashboardFrom === targetDashboardId) return;
            protect(share.pkImpactId, lower(share.destinator));
        });
        const targetMs = new Date(creationDateIso).getTime();
        const isTargetBoard = (board: any) =>
            board.dashboardId === targetDashboardId ||
            (Number(board.boardVersion) === version && Number(board.boardIteration) === iteration &&
                board.creationDate && new Date(board.creationDate).getTime() === targetMs);
        otherBoards.forEach((board: any) => {
            if (isTargetBoard(board)) return;
            if (NON_GRANTING_STATUSES.includes(String(board.boardStatus || "").toLowerCase())) return;
            const members = dashboardMembers(board);
            toPkList(board.pkImpactIdList).forEach(pk => protect(pk, members));
        });

        const removalSet = (pk: number): Set<string> => {
            const wanted = revokeFor.get(pk) || [];
            const keep = protectedByPk.get(pk);
            return new Set(keep ? wanted.filter(u => !keep.has(u)) : wanted);
        };

        const updateAccess = (obj: any, pk: unknown) => {
            const key = Number(pk);
            const add = grantFor.get(key) || [];
            const remove = removalSet(key);
            if (add.length === 0 && remove.size === 0) return;
            const next = applyAccess(obj[readField], add, remove);
            if (sameMembers(obj[readField], next)) return; // skip no-op edits
            batch.update(obj, { [readField]: next } as any);
        };

        const touchedSet = new Set(touchedPks);
        roRows.forEach((ro: any) => { if (touchedSet.has(Number(ro.pkImpactId))) updateAccess(ro, ro.pkImpactId); });
        mitigations.forEach((m: any) => updateAccess(m, m.pkImpactIdAsString));
        waterfalls.forEach((w: any) => updateAccess(w, w.pkImpactIdAsString));

        // ==========================================
        // PHASE 6: PER-DASHBOARD RISK RECORDS
        // ==========================================
        const perimeterRows = roRows.filter((ro: any) => finalPkSet.has(Number(ro.pkImpactId)));
        if (perimeterRows.length === 0) return batch.getEdits();

        const perimeterPks = perimeterRows.map((ro: any) => Number(ro.pkImpactId));
        const [existingInputRisks, sourceInputRisks] = await Promise.all([
            isCreation
                ? Promise.resolve([]) // brand-new target: no records yet
                : fetchAllIn(client, TargetRiskType, "pkImpactId", perimeterPks, {
                    dashboardCreationDate: creationDateIso,
                    boardVersion: version,
                    boardIteration: iteration,
                }),
            (action === "duplicate" || action === "create_iteration")
                ? fetchAllIn(client, TargetRiskType, "pkImpactId", perimeterPks, {
                    dashboardCreationDate: toIso(creationDateBasedOn),
                    boardVersion: Number(boardVersionBasedOn),
                    boardIteration: Number(boardIterationBasedOn),
                })
                : Promise.resolve([]),
        ]);

        const existingByPk = new Map<number, any>(existingInputRisks.filter((r: any) => r.pkImpactId).map((r: any) => [Number(r.pkImpactId), r]));
        const sourceByPk = new Map<number, any>(sourceInputRisks.filter((r: any) => r.pkImpactId).map((r: any) => [Number(r.pkImpactId), r]));

        perimeterRows.forEach((ro: any) => {
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

                const idx = requestedPks.indexOf(pk);
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

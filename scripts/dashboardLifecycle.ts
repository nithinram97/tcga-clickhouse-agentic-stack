import type { DashboardDisplay } from '../types/dashboard';

/**
 * Dashboard lifecycle helpers (create / edit / new iteration / new version / permissions-only).
 *
 * A dashboard "family" shares one creationDate epoch. Inside a family, `boardVersion` is the major
 * version (V2.x = "New version") and `boardIteration` the minor one (V1.2 = auto-iteration after
 * the dashboard got validated / locked). The dashboard id is `${epoch}___${version}___${iteration}`.
 */

export type DashboardDialogMode =
  | 'create' // Scenario 1 & 2 (from scratch, or "Report based on")
  | 'edit' // Scenario 3
  | 'iteration' // Scenario 4 (edit of a locked dashboard -> V x.(y+1))
  | 'version' // Scenario 5 (new major version -> V (x+1).1)
  | 'permissions'; // Scenario 7 (locked / non-latest: access management only)

export interface DashboardIdentity {
  epoch: number;
  version: number;
  iteration: number;
  key: string;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parses epoch numbers, ISO strings and the Airbus display format "24-Aug-2026 14:30". */
export function parseDateToEpoch(value: unknown): number | null {
  if (value == null || value === '' || value === '-') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const str = String(value).trim();
  if (/^\d{10,13}$/.test(str)) return Number(str.length === 10 ? `${str}000` : str);

  const m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month !== undefined) {
      return new Date(Number(m[3]), month, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)).getTime();
    }
  }
  const parsed = Date.parse(str);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Exact identity of a dashboard. The id is preferred over creationDate because the list shows
 * creationDate formatted to the minute, which would not match the stored millisecond epoch.
 */
export function getDashboardIdentity(d: DashboardDisplay | null | undefined): DashboardIdentity | null {
  if (!d) return null;
  let epoch: number | null = null;
  let version = Number(d.boardVersion ?? NaN);
  let iteration = Number(d.boardIteration ?? NaN);

  const rawId = String(d.dashboardId ?? (d as Record<string, unknown>).dashboard_id ?? '');
  if (rawId.includes('___')) {
    const [p0, p1, p2] = rawId.split('___');
    epoch = /^\d+$/.test(p0) ? Number(p0) : parseDateToEpoch(p0);
    if (Number.isNaN(version)) version = Number(p1);
    if (Number.isNaN(iteration)) iteration = Number(p2);
  }
  if (epoch == null) epoch = parseDateToEpoch(d.creationDate);
  if (epoch == null) return null;

  version = Number.isFinite(version) && version > 0 ? version : 1;
  iteration = Number.isFinite(iteration) && iteration > 0 ? iteration : 1;
  return { epoch, version, iteration, key: `${epoch}___${version}___${iteration}` };
}

const truthy = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';

/** Validated, past its editable deadline, or in a released/validated status. */
export function isDashboardLocked(d: DashboardDisplay | null | undefined): boolean {
  if (!d) return false;
  if (truthy(d.validation)) return true;
  const until = parseDateToEpoch(d.editableUntil);
  if (until != null && until < Date.now()) return true;
  const status = String(d.boardStatus || '').toLowerCase();
  return status === 'validated' || status === 'released' || status === 'locked';
}

/** All dashboards of the same family (same creation epoch). */
export function getFamily(all: DashboardDisplay[], d: DashboardDisplay): DashboardDisplay[] {
  const id = getDashboardIdentity(d);
  if (!id) return [d];
  return all.filter((x) => getDashboardIdentity(x)?.epoch === id.epoch);
}

const compareIdentity = (a: DashboardIdentity, b: DashboardIdentity) =>
  a.version - b.version || a.iteration - b.iteration;

/** Latest version/iteration of the family (the only one that may be edited). */
export function isLatestInFamily(all: DashboardDisplay[], d: DashboardDisplay): boolean {
  const id = getDashboardIdentity(d);
  if (!id) return true;
  return getFamily(all, d).every((x) => {
    const xi = getDashboardIdentity(x);
    return !xi || compareIdentity(xi, id) <= 0;
  });
}

/** Next free iteration within the same major version: V1.2 -> V1.3 (skips iterations that already exist). */
export function getNextIteration(all: DashboardDisplay[], d: DashboardDisplay): DashboardIdentity | null {
  const id = getDashboardIdentity(d);
  if (!id) return null;
  const max = getFamily(all, d)
    .map(getDashboardIdentity)
    .filter((x): x is DashboardIdentity => Boolean(x) && x!.version === id.version)
    .reduce((m, x) => Math.max(m, x.iteration), id.iteration);
  const iteration = max + 1;
  return { epoch: id.epoch, version: id.version, iteration, key: `${id.epoch}___${id.version}___${iteration}` };
}

/** Next major version of the family: V1.3 -> V2.1. */
export function getNextVersion(all: DashboardDisplay[], d: DashboardDisplay): DashboardIdentity | null {
  const id = getDashboardIdentity(d);
  if (!id) return null;
  const max = getFamily(all, d)
    .map(getDashboardIdentity)
    .filter((x): x is DashboardIdentity => Boolean(x))
    .reduce((m, x) => Math.max(m, x.version), id.version);
  const version = max + 1;
  return { epoch: id.epoch, version, iteration: 1, key: `${id.epoch}___${version}___1` };
}

/** Which dialog mode the plain "Edit" action should open. */
export function resolveEditMode(all: DashboardDisplay[], d: DashboardDisplay): DashboardDialogMode {
  if (!isLatestInFamily(all, d)) return 'permissions';
  return isDashboardLocked(d) ? 'iteration' : 'edit';
}

/** Users added / removed between two permission snapshots (case-insensitive, original casing kept). */
export function computePermissionDelta(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const norm = (s: string) => s.trim().toLowerCase();
  const beforeSet = new Set(before.map(norm));
  const afterSet = new Set(after.map(norm));
  const uniq = (list: string[]) => Array.from(new Map(list.map((s) => [norm(s), s.trim()])).values());
  return {
    added: uniq(after).filter((s) => !beforeSet.has(norm(s))),
    removed: uniq(before).filter((s) => !afterSet.has(norm(s))),
  };
}

/** True when the current user is listed in a permission field (emails or display names). */
export function isUserListed(field: unknown, email: string, displayName?: string): boolean {
  if (!field || !email) return false;
  const items = (Array.isArray(field) ? field : String(field).replace(/^\[|\]$/g, '').split(','))
    .map((s) => String(s).replace(/"/g, '').trim().toLowerCase())
    .filter(Boolean);
  const e = email.toLowerCase();
  const n = displayName?.toLowerCase();
  return items.some((i) => i === e || (n ? i === n : false));
}

import type { DashboardDisplay } from '../types/dashboard';
import { getDashboardIdentity, parseDateToEpoch } from './dashboardLifecycle';

export interface DashboardGroup {
  groupId: string;
  parent: DashboardDisplay;
  children: DashboardDisplay[];
}

const lastTouched = (d: DashboardDisplay) => parseDateToEpoch(d.lastUpdatedOn) ?? parseDateToEpoch(d.creationDate) ?? 0;

/**
 * One group per dashboard family (same creation epoch). The parent row is the latest
 * version/iteration (V2.1 before V1.3 before V1.2); groups are ordered by most recent activity.
 */
export function groupAndSortDashboards(dashboards: DashboardDisplay[]): DashboardGroup[] {
  const groupsMap = new Map<string, DashboardDisplay[]>();

  dashboards.forEach((dash) => {
    const id = getDashboardIdentity(dash);
    const groupKey = id ? String(id.epoch) : dash.creationDate || dash.dashboardId || 'unknown-group';
    if (!groupsMap.has(groupKey)) groupsMap.set(groupKey, []);
    groupsMap.get(groupKey)!.push(dash);
  });

  const groupedResults: DashboardGroup[] = [];

  groupsMap.forEach((items, groupId) => {
    const sortedItems = [...items].sort((a, b) => {
      const ia = getDashboardIdentity(a);
      const ib = getDashboardIdentity(b);
      if (ia && ib && (ia.version !== ib.version || ia.iteration !== ib.iteration)) {
        return ib.version - ia.version || ib.iteration - ia.iteration;
      }
      return lastTouched(b) - lastTouched(a);
    });

    const [parent, ...children] = sortedItems;
    groupedResults.push({ groupId, parent, children });
  });

  return groupedResults.sort(
    (a, b) =>
      Math.max(lastTouched(b.parent), ...b.children.map(lastTouched)) -
      Math.max(lastTouched(a.parent), ...a.children.map(lastTouched)),
  );
}

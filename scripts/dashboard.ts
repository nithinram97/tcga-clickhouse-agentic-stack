export interface DashboardDisplay {
  dashboardId?: string;
  boardTitle?: string;
  reportType?: string;
  boardStatus?: string;
  ownerDashboard?: string;
  creationDate?: string;
  lastUpdatedOn?: string;
  boardIteration?: number;
  boardVersion?: number;
  permissionsReadNames_display?: string;
  permissionsWriteNames_display?: string;
  permissionsOwnerNames_display?: string;
  permissionsOfficerNames_display?: string;
  isEditor?: string;
  isOwner?: string;
  settings?: string;
  /** Lifecycle fields (optional: only used when ermGetDashboardList returns them). */
  validation?: boolean | string;
  editableUntil?: string | number;
  pkImpactIdList?: number[] | string;
}


import { useState, useMemo } from 'react';
import { Share2 } from 'lucide-react';
import { useDashboards } from '../hooks/useDashboards';
import { useErmUsers } from '../hooks/useErmUsers';
import { matchUserPermission } from '../utils/permissionMatcher';
import { DashboardTable } from '../components/DashboardTable';
import { AddDashboardDialog } from '../components/AddDashboardDialog';
import { AppHeader } from '../components/Appheader';
import { RiskSharingView } from '../components/RiskSharingView';
import { Button } from '../../@/components/ui/button';
import { type DateRange } from 'react-day-picker';
import type { DashboardDisplay } from '../types/dashboard';
import type { DashboardDialogMode } from '../utils/dashboardLifecycle';

/**
 * Parses dates across standard ISO, numeric Unix timestamps, and Airbus string formats (e.g. "24-Aug-2026 14:30").
 */
const parseFlexibleDate = (dateVal: unknown): number | null => {
  if (dateVal === null || dateVal === undefined || dateVal === '' || dateVal === '-') {
    return null;
  }

  if (typeof dateVal === 'number' && !isNaN(dateVal)) {
    return dateVal;
  }

  const str = String(dateVal).trim();

  // Handle numeric timestamp strings (e.g. "1724483040000")
  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    if (!isNaN(num)) return num;
  }

  // Try standard JS Date parse (e.g. ISO 8601)
  let parsed = Date.parse(str);
  if (!isNaN(parsed)) return parsed;

  // Reformat custom Airbus format "24-Aug-2026 14:30" to "24 Aug 2026 14:30"
  const cleaned = str.replace(/-/g, ' ');
  parsed = Date.parse(cleaned);
  if (!isNaN(parsed)) return parsed;

  return null;
};

/**
 * Checks if a parsed date falls within a selected DateRange.
 */
const isDateInRange = (dateVal: unknown, range?: DateRange): boolean => {
  if (!range || (!range.from && !range.to)) {
    return true;
  }

  const time = parseFlexibleDate(dateVal);
  if (time === null) {
    return false;
  }

  const fromTime = range.from ? new Date(range.from).setHours(0, 0, 0, 0) : null;
  const targetToDate = range.to || range.from;
  const toTime = targetToDate ? new Date(targetToDate).setHours(23, 59, 59, 999) : null;

  if (fromTime !== null && time < fromTime) return false;
  if (toTime !== null && time > toTime) return false;

  return true;
};

export default function DashboardListPage({ currentUserEmail }: { currentUserEmail: string }) {
  const { dashboards, isLoading, combinedSiglums, refetch } = useDashboards(currentUserEmail);
  const { users: ermUsers, isLoadingUsers } = useErmUsers();

  const [activeTab, setActiveTab] = useState<'standard' | 'access' | 'riskSharing'>('standard');
  const [isAccessView, setIsAccessView] = useState(false);

  // Dialog & Filter States
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [dashboardToEdit, setDashboardToEdit] = useState<DashboardDisplay | null>(null);
  const [dialogMode, setDialogMode] = useState<DashboardDialogMode>('create');

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [siglumFilter, setSiglumFilter] = useState('');
  const [creationRange, setCreationRange] = useState<DateRange | undefined>();
  const [updateRange, setUpdateRange] = useState<DateRange | undefined>();

  const [readerFilter, setReaderFilter] = useState('All');
  const [writerFilter, setWriterFilter] = useState('All');
  const [ownerFilter, setOwnerFilter] = useState('All');
  const [officerFilter, setOfficerFilter] = useState('All');

  // Filtered Dashboards Memoization
  const filteredDashboards = useMemo(() => {
    return dashboards.filter((dash: DashboardDisplay) => {
      if (searchQuery && !dash.boardTitle?.toLowerCase().includes(searchQuery.toLowerCase())) return false;

      if (isAccessView) {
        if (!matchUserPermission(dash.permissionsReadNames_display, readerFilter, ermUsers)) return false;
        if (!matchUserPermission(dash.permissionsWriteNames_display, writerFilter, ermUsers)) return false;
        if (!matchUserPermission(dash.permissionsOwnerNames_display, ownerFilter, ermUsers)) return false;
        if (!matchUserPermission(dash.permissionsOfficerNames_display, officerFilter, ermUsers)) return false;
      } else {
        if (statusFilter !== 'All' && (dash.boardStatus || 'Draft').toLowerCase() !== statusFilter.toLowerCase())
          return false;
        if (
          siglumFilter &&
          siglumFilter !== 'All' &&
          !(dash.ownerDashboard || '').toLowerCase().includes(siglumFilter.toLowerCase())
        )
          return false;

        // Apply Creation Date & Last Edit Date Range Filters
        if (!isDateInRange(dash.creationDate, creationRange)) return false;
        if (!isDateInRange(dash.lastUpdatedOn, updateRange)) return false;
      }
      return true;
    });
  }, [
    dashboards,
    isAccessView,
    searchQuery,
    statusFilter,
    siglumFilter,
    creationRange,
    updateRange,
    readerFilter,
    writerFilter,
    ownerFilter,
    officerFilter,
    ermUsers,
  ]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <AppHeader currentUserEmail={currentUserEmail} />

      <div className="p-6 max-w-full w-full mx-auto space-y-6 flex-1">
        {/* Single Line Header Bar: Tabs on Left, New Dashboard Button on Right */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 gap-4">
          <div className="bg-white border border-slate-200 p-1 rounded-md flex text-sm shadow-sm gap-1">
            <Button
              variant={activeTab === 'standard' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setActiveTab('standard');
                setIsAccessView(false);
              }}
              className={activeTab === 'standard' ? 'bg-airbus-light text-airbus-navy font-medium' : 'text-slate-500'}
            >
              Standard View
            </Button>

            <Button
              variant={activeTab === 'access' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setActiveTab('access');
                setIsAccessView(true);
              }}
              className={activeTab === 'access' ? 'bg-airbus-light text-airbus-navy font-medium' : 'text-slate-500'}
            >
              🛡️ Access View
            </Button>

            <Button
              variant={activeTab === 'riskSharing' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setActiveTab('riskSharing');
                setIsAccessView(false);
              }}
              className={
                activeTab === 'riskSharing'
                  ? 'bg-airbus-light text-airbus-navy font-medium flex items-center gap-1.5'
                  : 'text-slate-500 flex items-center gap-1.5'
              }
            >
              <Share2 className="h-3.5 w-3.5 text-airbus-navy" />
              <span>R&O Sharing</span>
            </Button>
          </div>

          <Button
            onClick={() => {
              setDashboardToEdit(null);
              setDialogMode('create');
              setIsAddDialogOpen(true);
            }}
            className="bg-airbus-navy hover:bg-airbus-blue text-white shadow-md cursor-pointer shrink-0"
          >
            + New Dashboard
          </Button>
        </div>

        {/* Render Tab Views */}
        {activeTab === 'riskSharing' ? (
          <RiskSharingView currentUserEmail={currentUserEmail} />
        ) : (
          <DashboardTable
            dashboards={filteredDashboards}
            isLoading={isLoading || isLoadingUsers}
            isAccessView={isAccessView}
            combinedSiglums={combinedSiglums}
            allUsers={ermUsers}
            currentUserEmail={currentUserEmail}
            onEditDashboard={(dash, mode = 'edit') => {
              setDashboardToEdit(dash);
              setDialogMode(mode);
              setIsAddDialogOpen(true);
            }}
            filters={{
              searchQuery,
              setSearchQuery,
              statusFilter,
              setStatusFilter,
              siglumFilter,
              setSiglumFilter,
              creationRange,
              setCreationRange,
              updateRange,
              setUpdateRange,
              readerFilter,
              setReaderFilter,
              writerFilter,
              setWriterFilter,
              ownerFilter,
              setOwnerFilter,
              officerFilter,
              setOfficerFilter,
            }}
          />
        )}

        <AddDashboardDialog
          open={isAddDialogOpen}
          onOpenChange={setIsAddDialogOpen}
          currentUserEmail={currentUserEmail}
          allUsers={ermUsers}
          combinedSiglums={combinedSiglums}
          dashboardToEdit={dashboardToEdit}
          mode={dialogMode}
          onSuccess={() => refetch()}
          allDashboards={dashboards}
        />
      </div>
    </div>
  );
}




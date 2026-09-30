
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { groupAndSortDashboards } from '../utils/dashboardGrouping';
import { PermissionBadges } from './PermissionBadges';
import { UserCombobox } from './UserCombobox';
import type { DashboardDisplay } from '../types/dashboard';
import {
  ChevronRight,
  ChevronDown,
  MoreVertical,
  Calendar as CalendarIcon,
  Check,
  ChevronsUpDown,
  X,
  Pencil,
  Lock,
  GitBranch,
  Shield,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../../@/lib/utils';
import { type FormattedUser } from '../hooks/useErmUsers';
import type { DateRange } from 'react-day-picker';
import {
  getNextIteration,
  getNextVersion,
  isDashboardLocked,
  isLatestInFamily,
  isUserListed,
  type DashboardDialogMode,
} from '../utils/dashboardLifecycle';

// UI Components
import { Button } from '../../@/components/ui/button';
import { Input } from '../../@/components/ui/input';
import { Badge } from '../../@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '../../@/components/ui/popover';
import { Calendar } from '../../@/components/ui/calendar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../@/components/ui/command';

export interface TableFilters {
  searchQuery?: string;
  setSearchQuery: (_val: string) => void;
  statusFilter?: string;
  setStatusFilter: (_val: string) => void;
  siglumFilter?: string;
  setSiglumFilter: (_val: string) => void;
  creationRange?: DateRange;
  setCreationRange: (_val?: DateRange) => void;
  updateRange?: DateRange;
  setUpdateRange: (_val?: DateRange) => void;
  readerFilter?: string;
  setReaderFilter: (_val: string) => void;
  writerFilter?: string;
  setWriterFilter: (_val: string) => void;
  ownerFilter?: string;
  setOwnerFilter: (_val: string) => void;
  officerFilter?: string;
  setOfficerFilter: (_val: string) => void;
}

interface DashboardTableProps {
  dashboards: DashboardDisplay[];
  isLoading: boolean;
  isAccessView: boolean;
  combinedSiglums: string[];
  allUsers?: FormattedUser[];
  filters: TableFilters;
  currentUserEmail?: string;
  /** mode: edit | iteration | version | permissions (defaults to edit for older callers) */
  onEditDashboard?: (_dashboard: DashboardDisplay, _mode?: DashboardDialogMode) => void;
}

export const DashboardTable: React.FC<DashboardTableProps> = ({
  dashboards,
  isLoading,
  isAccessView,
  combinedSiglums = [],
  allUsers = [],
  filters,
  currentUserEmail = '',
  onEditDashboard,
}) => {
  const navigate = useNavigate();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [openSiglumCombo, setOpenSiglumCombo] = useState(false);

  const toggleGroup = (groupId: string) => setExpandedGroups((p) => ({ ...p, [groupId]: !p[groupId] }));
  const groupedDashboards = useMemo(() => groupAndSortDashboards(dashboards), [dashboards]);

  const currentUserName = useMemo(
    () => allUsers.find((u) => u.key.toLowerCase() === currentUserEmail.toLowerCase())?.key_display,
    [allUsers, currentUserEmail],
  );

  const isFlag = (v: unknown) => v === true || v === 'true';
  const isOfficer = (dash: DashboardDisplay) =>
    isUserListed(dash.permissionsOfficerNames_display, currentUserEmail, currentUserName);
  /** Owners and officers manage versions and permissions (same rule as the backend workflow). */
  const canManage = (dash: DashboardDisplay) => isFlag(dash.isOwner) || isOfficer(dash);
  const hasEditAccess = (dash: DashboardDisplay) => isFlag(dash.isEditor) || canManage(dash);

  // Navigates to /dashboard/{dashboardID}/maps on dashboard name click
  const handleOpenDashboard = (dash: DashboardDisplay) => {
    const rawId = dash.dashboardId || (dash as Record<string, unknown>).dashboard_id;
    let dashId = rawId;

    if (!dashId && dash.creationDate) {
      const epoch = Date.parse(dash.creationDate);
      if (!isNaN(epoch)) {
        dashId = `${epoch}___${dash.boardVersion ?? 1}___${dash.boardIteration ?? 1}`;
      }
    }

    if (!dashId) {
      dashId = dash.boardTitle || 'dashboard';
    }

    navigate(`/dashboard/${encodeURIComponent(String(dashId))}/maps`);
  };

  if (isLoading) {
    return (
      <div className="p-12 text-center text-airbus-navy font-medium bg-white border border-slate-200 rounded-lg shadow-sm">
        Loading Cockpit Dashboards...
      </div>
    );
  }

  const renderActionMenu = (dash: DashboardDisplay) => {
    if (!hasEditAccess(dash)) return null;

    const latest = isLatestInFamily(dashboards, dash);
    const locked = isDashboardLocked(dash);
    const manage = canManage(dash);
    const nextIter = getNextIteration(dashboards, dash);
    const nextVer = getNextVersion(dashboards, dash);

    const items: { key: string; label: string; icon: React.ReactNode; mode: DashboardDialogMode; hint?: string }[] = [];
    if (latest && !locked) {
      items.push({ key: 'edit', label: 'Edit', icon: <Pencil className="h-3.5 w-3.5 text-airbus-blue" />, mode: 'edit' });
    }
    if (latest && locked && manage && nextIter) {
      items.push({
        key: 'iteration',
        label: `Edit (new iteration V${nextIter.version}.${nextIter.iteration})`,
        icon: <Lock className="h-3.5 w-3.5 text-amber-600" />,
        mode: 'iteration',
        hint: 'Validated dashboards are never modified; changes go into a new iteration',
      });
    }
    if (manage && nextVer) {
      items.push({
        key: 'version',
        label: `New version (V${nextVer.version}.1)`,
        icon: <GitBranch className="h-3.5 w-3.5 text-airbus-blue" />,
        mode: 'version',
      });
    }
    if (manage && (locked || !latest)) {
      items.push({
        key: 'permissions',
        label: 'Edit permissions',
        icon: <Shield className="h-3.5 w-3.5 text-airbus-blue" />,
        mode: 'permissions',
      });
    }
    if (items.length === 0) return null;

    return (
      <Popover>
        <PopoverTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-airbus-navy/50 hover:text-airbus-navy hover:bg-airbus-light cursor-pointer transition-colors">
          <MoreVertical className="h-4 w-4" />
        </PopoverTrigger>
        <PopoverContent className="w-60 p-1" align="end">
          {items.map((it) => (
            <Button
              key={it.key}
              variant="ghost"
              size="sm"
              title={it.hint}
              className="w-full justify-start gap-2 text-xs font-normal h-8 px-2 text-slate-700 hover:bg-slate-100 cursor-pointer"
              onClick={() => onEditDashboard?.(dash, it.mode)}
            >
              {it.icon}
              {it.label}
            </Button>
          ))}
          {locked && (
            <div className="mt-1 border-t border-slate-100 px-2 py-1 text-[10px] text-slate-400">
              <Lock className="mr-1 inline h-3 w-3" /> Validated / locked
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <Table className="table-fixed w-full">
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[30%] text-airbus-navy font-semibold text-xs py-3.5">Dashboard Name</TableHead>
            {isAccessView ? (
              <>
                <TableHead className="w-[16%] text-airbus-navy font-semibold text-xs">Reader Name</TableHead>
                <TableHead className="w-[16%] text-airbus-navy font-semibold text-xs">Writer Name</TableHead>
                <TableHead className="w-[16%] text-airbus-navy font-semibold text-xs">Owner Name</TableHead>
                <TableHead className="w-[16%] text-airbus-navy font-semibold text-xs">Officer Name</TableHead>
                <TableHead className="w-[6%] text-right"></TableHead>
              </>
            ) : (
              <>
                <TableHead className="w-[12%] text-airbus-navy font-semibold text-xs">Status</TableHead>
                <TableHead className="w-[15%] text-airbus-navy font-semibold text-xs">Siglum Owner</TableHead>
                <TableHead className="w-[18%] text-airbus-navy font-semibold text-xs">Creation Date</TableHead>
                <TableHead className="w-[19%] text-airbus-navy font-semibold text-xs">Last Edit Date</TableHead>
                <TableHead className="w-[6%] text-right"></TableHead>
              </>
            )}
          </TableRow>

          {/* Filters Row */}
          <TableRow className="bg-airbus-light/30 hover:bg-airbus-light/30">
            <TableCell className="py-2 px-3">
              <Input
                placeholder="Search Title..."
                className="h-8 text-xs bg-white"
                value={filters.searchQuery || ''}
                onChange={(e) => filters.setSearchQuery(e.target.value)}
              />
            </TableCell>

            {isAccessView ? (
              <>
                <TableCell className="py-2 px-3">
                  <UserCombobox
                    users={allUsers}
                    value={filters.readerFilter || 'All'}
                    onChange={filters.setReaderFilter}
                    placeholder="All Readers"
                  />
                </TableCell>
                <TableCell className="py-2 px-3">
                  <UserCombobox
                    users={allUsers}
                    value={filters.writerFilter || 'All'}
                    onChange={filters.setWriterFilter}
                    placeholder="All Writers"
                  />
                </TableCell>
                <TableCell className="py-2 px-3">
                  <UserCombobox
                    users={allUsers}
                    value={filters.ownerFilter || 'All'}
                    onChange={filters.setOwnerFilter}
                    placeholder="All Owners"
                  />
                </TableCell>
                <TableCell className="py-2 px-3">
                  <UserCombobox
                    users={allUsers}
                    value={filters.officerFilter || 'All'}
                    onChange={filters.setOfficerFilter}
                    placeholder="All Officers"
                  />
                </TableCell>
                <TableCell className="py-2 px-3"></TableCell>
              </>
            ) : (
              <>
                <TableCell className="py-2 px-3">
                  <Select
                    value={filters.statusFilter || 'All'}
                    onValueChange={(val) => filters.setStatusFilter(val ?? 'All')}
                  >
                    <SelectTrigger className="h-8 text-xs bg-white text-airbus-navy">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Statuses</SelectItem>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Released">Released</SelectItem>
                      <SelectItem value="Draft">Draft</SelectItem>
                      <SelectItem value="Validated">Validated</SelectItem>
                      <SelectItem value="Deleted">Deleted</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>

                {/* Siglum Owner Combobox */}
                <TableCell className="py-2 px-3">
                  <Popover open={openSiglumCombo} onOpenChange={setOpenSiglumCombo}>
                    <PopoverTrigger className="flex h-8 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-2 text-left text-xs font-normal outline-none hover:bg-slate-50 transition-colors">
                      <span className="truncate">
                        {filters.siglumFilter && filters.siglumFilter !== 'All' ? filters.siglumFilter : 'All Siglums'}
                      </span>
                      <div className="flex items-center gap-1">
                        {filters.siglumFilter && filters.siglumFilter !== 'All' && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              filters.setSiglumFilter('All');
                            }}
                            className="p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </span>
                        )}
                        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-50 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search siglum..." className="h-8 text-xs" />
                        <CommandList>
                          <CommandEmpty className="py-2 text-center text-xs">No siglum found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="All"
                              onSelect={() => {
                                filters.setSiglumFilter('All');
                                setOpenSiglumCombo(false);
                              }}
                              className="text-xs"
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-3 w-3',
                                  filters.siglumFilter === 'All' || !filters.siglumFilter ? 'opacity-100' : 'opacity-0',
                                )}
                              />
                              All Siglums
                            </CommandItem>
                            {combinedSiglums.map((s: string) => (
                              <CommandItem
                                key={s}
                                value={s}
                                onSelect={() => {
                                  filters.setSiglumFilter(s);
                                  setOpenSiglumCombo(false);
                                }}
                                className="text-xs"
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-3 w-3',
                                    filters.siglumFilter === s ? 'opacity-100' : 'opacity-0',
                                  )}
                                />
                                {s}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </TableCell>

                {/* Creation Date Range Picker */}
                <TableCell className="py-2 px-3">
                  <Popover>
                    <PopoverTrigger
                      className={cn(
                        'flex h-8 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-2 text-left text-xs font-normal outline-none hover:bg-slate-50 transition-colors',
                        !filters.creationRange?.from && 'text-slate-500',
                      )}
                    >
                      <div className="flex items-center truncate mr-1">
                        <CalendarIcon className="mr-2 h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {filters.creationRange?.from
                            ? filters.creationRange.to
                              ? `${format(new Date(filters.creationRange.from), 'LLL dd')} - ${format(new Date(filters.creationRange.to), 'LLL dd')}`
                              : format(new Date(filters.creationRange.from), 'LLL dd, y')
                            : 'Pick dates'}
                        </span>
                      </div>
                      {filters.creationRange?.from && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            filters.setCreationRange(undefined);
                          }}
                          className="p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
                        >
                          <X className="h-3 w-3" />
                        </span>
                      )}
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="range"
                        defaultMonth={filters.creationRange?.from ? new Date(filters.creationRange.from) : undefined}
                        selected={filters.creationRange}
                        onSelect={filters.setCreationRange}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                </TableCell>

                {/* Last Update Date Range Picker */}
                <TableCell className="py-2 px-3">
                  <Popover>
                    <PopoverTrigger
                      className={cn(
                        'flex h-8 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-2 text-left text-xs font-normal outline-none hover:bg-slate-50 transition-colors',
                        !filters.updateRange?.from && 'text-slate-500',
                      )}
                    >
                      <div className="flex items-center truncate mr-1">
                        <CalendarIcon className="mr-2 h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {filters.updateRange?.from
                            ? filters.updateRange.to
                              ? `${format(new Date(filters.updateRange.from), 'LLL dd')} - ${format(new Date(filters.updateRange.to), 'LLL dd')}`
                              : format(new Date(filters.updateRange.from), 'LLL dd, y')
                            : 'Pick dates'}
                        </span>
                      </div>
                      {filters.updateRange?.from && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            filters.setUpdateRange(undefined);
                          }}
                          className="p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
                        >
                          <X className="h-3 w-3" />
                        </span>
                      )}
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="range"
                        defaultMonth={filters.updateRange?.from ? new Date(filters.updateRange.from) : undefined}
                        selected={filters.updateRange}
                        onSelect={filters.setUpdateRange}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                </TableCell>

                <TableCell className="py-2 px-3"></TableCell>
              </>
            )}
          </TableRow>
        </TableHeader>

        <TableBody>
          {groupedDashboards.map(({ groupId, parent, children }) => {
            const isExpanded = !!expandedGroups[groupId];
            const hasChildren = children.length > 0;
            return (
              <React.Fragment key={groupId}>
                <TableRow className="bg-white hover:bg-slate-50 transition-colors group">
                  <TableCell className="p-2.5 flex items-center gap-2">
                    {hasChildren ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-airbus-navy hover:bg-airbus-light"
                        onClick={() => toggleGroup(groupId)}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    ) : (
                      <span className="w-6 inline-block" />
                    )}

                    {/* Clickable Dashboard Name triggers navigation to /dashboard/{id}/maps */}
                    <span
                      className="truncate font-semibold text-airbus-navy hover:text-airbus-blue hover:underline cursor-pointer"
                      onClick={() => handleOpenDashboard(parent)}
                    >
                      {parent.boardTitle}{' '}
                      {parent.boardVersion && (
                        <span className="text-[11px] text-slate-500 font-normal">
                          (V{parent.boardVersion}.{parent.boardIteration})
                        </span>
                      )}
                    </span>

                    {hasChildren && (
                      <Badge className="bg-airbus-light text-airbus-blue border-airbus-blue/20 text-[10px] px-1.5 py-0">
                        +{children.length}
                      </Badge>
                    )}
                  </TableCell>

                  {isAccessView ? (
                    <>
                      <TableCell className="p-2 overflow-hidden">
                        <PermissionBadges namesString={parent.permissionsReadNames_display} />
                      </TableCell>
                      <TableCell className="p-2 overflow-hidden">
                        <PermissionBadges namesString={parent.permissionsWriteNames_display} />
                      </TableCell>
                      <TableCell className="p-2 overflow-hidden">
                        <PermissionBadges namesString={parent.permissionsOwnerNames_display} />
                      </TableCell>
                      <TableCell className="p-2 overflow-hidden">
                        <PermissionBadges namesString={parent.permissionsOfficerNames_display} />
                      </TableCell>
                      <TableCell className="p-2 text-right border-r-4 border-airbus-navy">
                        {renderActionMenu(parent)}
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="p-2.5">
                        <Badge className="bg-airbus-light text-airbus-navy border-airbus-blue/20 text-[11px]">
                          {parent.boardStatus || 'Draft'}
                        </Badge>
                        {isDashboardLocked(parent) && (
                          <Lock className="ml-1 inline h-3 w-3 text-amber-600" aria-label="Validated / locked" />
                        )}
                      </TableCell>
                      <TableCell className="p-2.5">
                        <div className="flex gap-1 flex-wrap">
                          {(parent.ownerDashboard ? parent.ownerDashboard.split(',') : ['O']).map(
                            (o: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-[11px] font-normal">
                                {o.trim()}
                              </Badge>
                            ),
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="p-2.5 text-slate-600 text-xs">{parent.creationDate || '-'}</TableCell>
                      <TableCell className="p-2.5 text-slate-600 text-xs">{parent.lastUpdatedOn || '-'}</TableCell>
                      <TableCell className="p-2.5 text-right border-r-4 border-airbus-navy">
                        {renderActionMenu(parent)}
                      </TableCell>
                    </>
                  )}
                </TableRow>

                {isExpanded &&
                  children.map((child, idx) => (
                    <TableRow key={idx} className="bg-airbus-light/20 hover:bg-airbus-light/50 transition-colors">
                      <TableCell className="p-2.5 pl-10 flex items-center">
                        {/* Clickable Sub-version Dashboard Name */}
                        <span
                          className="truncate text-xs text-slate-600 hover:text-airbus-blue hover:underline cursor-pointer"
                          onClick={() => handleOpenDashboard(child)}
                        >
                          ↳ {child.boardTitle}{' '}
                          {child.boardVersion && `(V${child.boardVersion}.${child.boardIteration})`}
                        </span>
                      </TableCell>
                      {isAccessView ? (
                        <>
                          <TableCell className="p-2 overflow-hidden">
                            <PermissionBadges namesString={child.permissionsReadNames_display} />
                          </TableCell>
                          <TableCell className="p-2 overflow-hidden">
                            <PermissionBadges namesString={child.permissionsWriteNames_display} />
                          </TableCell>
                          <TableCell className="p-2 overflow-hidden">
                            <PermissionBadges namesString={child.permissionsOwnerNames_display} />
                          </TableCell>
                          <TableCell className="p-2 overflow-hidden">
                            <PermissionBadges namesString={child.permissionsOfficerNames_display} />
                          </TableCell>
                          <TableCell className="p-2 text-right border-r-4 border-transparent">
                            {renderActionMenu(child)}
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="p-2.5">
                            <Badge variant="secondary" className="text-[10px] bg-slate-100">
                              {child.boardStatus || 'Draft'}
                            </Badge>
                            {isDashboardLocked(child) && <Lock className="ml-1 inline h-3 w-3 text-amber-600" />}
                          </TableCell>
                          <TableCell className="p-2.5">
                            <div className="flex gap-1 flex-wrap">
                              {(child.ownerDashboard ? child.ownerDashboard.split(',') : ['O']).map(
                                (o: string, i: number) => (
                                  <Badge key={i} variant="outline" className="text-[10px] text-slate-500 font-normal">
                                    {o.trim()}
                                  </Badge>
                                ),
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="p-2.5 text-slate-500 text-xs">{child.creationDate || '-'}</TableCell>
                          <TableCell className="p-2.5 text-slate-500 text-xs">{child.lastUpdatedOn || '-'}</TableCell>
                          <TableCell className="p-2.5 text-right border-r-4 border-transparent">
                            {renderActionMenu(child)}
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};




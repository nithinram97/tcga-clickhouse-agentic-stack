
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { executeAddEditWorkflow } from '@fca0-enterprise-risk-management/sdk';
import { client } from '../client';
import type { FormattedUser } from '../hooks/useErmUsers';
import { useRiskSharings, type ProcessedSharingItem } from '../hooks/useRiskSharings';
import { RiskSearchPanel, type RiskSearchResult } from './RiskSearchPanel';
import { RiskEscalationSharingDialog } from './RiskEscalationSharingDialog';
import { AddRiskToReportDialog } from './AddRiskToReportDialog';
import type { DashboardDisplay } from '../types/dashboard';
import { DEFAULT_NEUTRAL_SETTINGS } from '../types/dashboardSettings';
import { getScoreCode } from '../utils/reportTableUtils';
import { DashboardProvider, useDashboardContext, type ArmRoPayloadBundle } from '../context/DashboardContext';
import {
  computePermissionDelta,
  getDashboardIdentity,
  getNextIteration,
  getNextVersion,
  isDashboardLocked,
  isLatestInFamily,
  isUserListed,
  type DashboardDialogMode,
  type DashboardIdentity,
} from '../utils/dashboardLifecycle';
import {
  Search,
  Shield,
  Loader2,
  X,
  Check,
  ChevronsUpDown,
  Share2,
  ChevronDown,
  ChevronRight,
  PlusCircle,
  Lock,
  GitBranch,
  Info,
} from 'lucide-react';
import { cn } from '../../@/lib/utils';
import { format } from 'date-fns';

// Pure shadcn/ui Components
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '../../@/components/ui/dialog';
import { Button } from '../../@/components/ui/button';
import { Input } from '../../@/components/ui/input';
import { Badge } from '../../@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '../../@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../@/components/ui/command';

interface AddDashboardDialogProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  currentUserEmail: string;
  allUsers: FormattedUser[];
  combinedSiglums: string[];
  allDashboards?: DashboardDisplay[];
  /** Source dashboard for edit / iteration / version / permissions modes. */
  dashboardToEdit?: DashboardDisplay | null;
  /** Lifecycle mode. Defaults to 'edit' when a dashboard is given, else 'create'. */
  mode?: DashboardDialogMode;
  onSuccess: () => void;
}

/* ------------------------------------------------------------------ */
/* Source dashboard payload (settings + authoritative risk perimeter)  */
/* ------------------------------------------------------------------ */

interface SourcePayloadState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  settings?: string;
  perimeter: RiskSearchResult[];
  error?: string;
}

const IDLE_SOURCE: SourcePayloadState = { status: 'idle', perimeter: [] };

const payloadSettingsToString = (settings: unknown): string | undefined => {
  if (!settings) return undefined;
  return typeof settings === 'string' ? settings : JSON.stringify(settings);
};

/** Perimeter = the dashboard's own rows (not rows shared in from other dashboards). */
const payloadToPerimeter = (payload: ArmRoPayloadBundle | null): RiskSearchResult[] =>
  Object.values(payload?.rows || {})
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const pk = Number(r.pk_impact_id || r.PKImpactID || r.primary_key);
      return {
        pkImpactId: pk,
        riskId: String(r.riskid_raw || pk),
        riskTitle: String(r.risktitle || r.arm_title || ''),
        riskDescription: String(r.riskdescription || r.arm_description || ''),
        riskStatus: String(r.riskstatus || 'Active'),
        riskType: String(r.risktype || 'Risk'),
        riskScore: Number(r.riskscore ?? r.arm_score ?? 0),
        siglumOwner: String(r.siglum_owner || ''),
      } as RiskSearchResult;
    })
    .filter((r) => Number.isFinite(r.pkImpactId) && r.pkImpactId > 0);

/** Lives inside a DashboardProvider for the source dashboard and reports its payload upwards. */
const SourcePayloadBridge: React.FC<{ onChange: (_s: SourcePayloadState) => void }> = ({ onChange }) => {
  const { armRoPayload, isLoadingPayload, payloadError } = useDashboardContext();
  useEffect(() => {
    if (isLoadingPayload) onChange({ status: 'loading', perimeter: [] });
    else if (payloadError) onChange({ status: 'error', perimeter: [], error: payloadError });
    else
      onChange({
        status: 'ready',
        settings: payloadSettingsToString(armRoPayload?.settings),
        perimeter: payloadToPerimeter(armRoPayload),
      });
  }, [armRoPayload, isLoadingPayload, payloadError, onChange]);
  return null;
};

const ACTION_TYPE: Record<DashboardDialogMode, string> = {
  create: 'add',
  edit: 'edit',
  permissions: 'edit',
  iteration: 'create_iteration',
  version: 'duplicate',
};

const parseStringArray = (val: unknown): string[] => {
  if (!val) return [];
  if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean);
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((s) => String(s).trim()).filter(Boolean);
        }
      } catch {
        // Fallback
      }
    }
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

const resolveToUserEmails = (rawItems: string[], userList: FormattedUser[]): string[] => {
  const emails: string[] = [];
  rawItems.forEach((item) => {
    const itemLower = item.toLowerCase().trim();
    if (!itemLower) return;

    const matched = userList.find(
      (u) => u.key.toLowerCase() === itemLower || u.key_display.toLowerCase() === itemLower,
    );
    if (matched) {
      emails.push(matched.key);
    } else {
      emails.push(item.trim());
    }
  });
  return Array.from(new Set(emails));
};

export const AddDashboardDialog: React.FC<AddDashboardDialogProps> = ({
  open,
  onOpenChange,
  currentUserEmail,
  allUsers = [],
  combinedSiglums = [],
  allDashboards = [],
  dashboardToEdit = null,
  mode: modeProp,
  onSuccess,
}) => {
  const mode: DashboardDialogMode = modeProp ?? (dashboardToEdit ? 'edit' : 'create');
  const isEditMode = mode !== 'create';
  const isPermissionsOnly = mode === 'permissions';
  const isNewRecord = mode === 'create' || mode === 'iteration' || mode === 'version';

  /* Only owners / officers may change access (the workflow ignores it from writers). */
  const canEditAccess = useMemo(() => {
    if (mode === 'create' || !dashboardToEdit) return true;
    const owner = dashboardToEdit.isOwner as unknown;
    if (owner === true || owner === 'true') return true;
    const me = allUsers.find((u) => u.key.toLowerCase() === currentUserEmail.toLowerCase());
    return isUserListed(dashboardToEdit.permissionsOfficerNames_display, currentUserEmail, me?.key_display);
  }, [mode, dashboardToEdit, allUsers, currentUserEmail]);

  // "Report based on" template (create mode only)
  const [basedOnKey, setBasedOnKey] = useState<string>('none');

  const [activeTab, setActiveTab] = useState<'selected' | 'search' | 'roShared'>('search');

  const [boardTitle, setBoardTitle] = useState('');
  const [reportType, setReportType] = useState('Report');
  const [boardStatus, setBoardStatus] = useState('Active');
  const [selectedSiglums, setSelectedSiglums] = useState<string[]>([]);
  const [selectedReaders, setSelectedReaders] = useState<string[]>([]);
  const [selectedWriters, setSelectedWriters] = useState<string[]>([]);
  const [selectedOwners, setSelectedOwners] = useState<string[]>([currentUserEmail]);

  const [selectedRisksMap, setSelectedRisksMap] = useState<Map<number, RiskSearchResult>>(new Map());

  const [sharingRiskItem, setSharingRiskItem] = useState<RiskSearchResult | null>(null);
  const [addRiskToReportItem, setAddRiskToReportItem] = useState<ProcessedSharingItem | null>(null);

  const nowFormatted = useMemo(() => format(new Date(), 'dd-MMM-yyyy HH:mm'), []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSearchingRisks, setIsSearchingRisks] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [openSiglumCombo, setOpenSiglumCombo] = useState(false);
  const [openAccessPopover, setOpenAccessPopover] = useState(false);

  const isInitializedRef = useRef(false);

  /* ---------- Dashboards available as template (latest of each family) ---------- */
  const templateOptions = useMemo(
    () =>
      allDashboards
        .filter((d) => d.boardTitle && getDashboardIdentity(d) && isLatestInFamily(allDashboards, d))
        .map((d) => ({ dash: d, id: getDashboardIdentity(d)! }))
        .sort((a, b) => String(a.dash.boardTitle).localeCompare(String(b.dash.boardTitle))),
    [allDashboards],
  );
  const basedOnDashboard = useMemo(
    () => (mode === 'create' ? (templateOptions.find((o) => o.id.key === basedOnKey)?.dash ?? null) : null),
    [mode, templateOptions, basedOnKey],
  );

  /* ---------- Source dashboard (whose settings / perimeter we start from) ---------- */
  const sourceDashboard = mode === 'create' ? basedOnDashboard : dashboardToEdit;
  const sourceIdentity = useMemo(() => getDashboardIdentity(sourceDashboard), [sourceDashboard]);
  const sourceProviderId = sourceDashboard ? String(sourceDashboard.dashboardId || sourceIdentity?.key || '') : '';

  const [sourcePayload, setSourcePayload] = useState<SourcePayloadState>(IDLE_SOURCE);
  const handleSourcePayload = useCallback((st: SourcePayloadState) => setSourcePayload(st), []);
  useEffect(() => {
    setSourcePayload(sourceProviderId ? { status: 'loading', perimeter: [] } : IDLE_SOURCE);
  }, [sourceProviderId]);

  /** Settings to write. Never fall back to defaults for an existing dashboard (that would wipe its layout). */
  const sourceSettings = useMemo(() => {
    const fromList = typeof sourceDashboard?.settings === 'string' ? sourceDashboard.settings.trim() : '';
    return fromList || sourcePayload.settings || '';
  }, [sourceDashboard, sourcePayload.settings]);

  /* ---------- Target identity (what the workflow will create / update) ---------- */
  const targetIdentity: DashboardIdentity | null = useMemo(() => {
    if (mode === 'create') return null; // assigned at submit time (Date.now())
    if (!dashboardToEdit) return null;
    if (mode === 'iteration') return getNextIteration(allDashboards, dashboardToEdit);
    if (mode === 'version') return getNextVersion(allDashboards, dashboardToEdit);
    return getDashboardIdentity(dashboardToEdit);
  }, [mode, dashboardToEdit, allDashboards]);

  const effectiveDashboardId = isEditMode ? sourceIdentity?.key : undefined;
  const currentDashboardKey = isEditMode ? sourceIdentity?.key : undefined;
  const sourceLabel = sourceIdentity ? `V${sourceIdentity.version}.${sourceIdentity.iteration}` : '';
  const targetLabel = targetIdentity ? `V${targetIdentity.version}.${targetIdentity.iteration}` : '';

  /* Permissions as they were when the dialog opened (for add/remove deltas). */
  const initialMembersRef = useRef<string[]>([]);
  const perimeterSeededRef = useRef(false);

  const resetForm = () => {
    setBoardTitle('');
    setReportType('Report');
    setBoardStatus('Active');
    setSelectedSiglums([]);
    setSelectedReaders([]);
    setSelectedWriters([]);
    setSelectedOwners([currentUserEmail]);
    setSelectedRisksMap(new Map());
    setIsSearchingRisks(false);
    setErrorMessage(null);
    setActiveTab('search');
    setBasedOnKey('none');
    initialMembersRef.current = [];
    perimeterSeededRef.current = false;
    setSharingRiskItem(null);
    setAddRiskToReportItem(null);
  };

  useEffect(() => {
    if (open) {
      if (!isInitializedRef.current) {
        isInitializedRef.current = true;
        if (dashboardToEdit) {
          setBoardTitle(dashboardToEdit.boardTitle || '');
          setReportType(dashboardToEdit.reportType || 'Report');
          setBoardStatus(dashboardToEdit.boardStatus || 'Active');
          setSelectedSiglums(
            dashboardToEdit.ownerDashboard
              ? dashboardToEdit.ownerDashboard
                  .split(',')
                  .map((s: string) => s.trim())
                  .filter(Boolean)
              : [],
          );

          const rawReaders = dashboardToEdit.permissionsReadNames_display;
          const rawWriters = dashboardToEdit.permissionsWriteNames_display;
          const rawOwners = dashboardToEdit.permissionsOwnerNames_display;

          setSelectedReaders(resolveToUserEmails(parseStringArray(rawReaders), allUsers));
          setSelectedWriters(resolveToUserEmails(parseStringArray(rawWriters), allUsers));

          const resolvedOwners = resolveToUserEmails(parseStringArray(rawOwners), allUsers);
          setSelectedOwners(resolvedOwners.length > 0 ? resolvedOwners : [currentUserEmail]);
          initialMembersRef.current = [
            ...resolveToUserEmails(parseStringArray(rawReaders), allUsers),
            ...resolveToUserEmails(parseStringArray(rawWriters), allUsers),
            ...resolvedOwners,
          ];
          perimeterSeededRef.current = false;
          setActiveTab(mode === 'permissions' ? 'selected' : 'search');

          const rawImpactIds = parseStringArray(
            (dashboardToEdit as Record<string, unknown>).pkImpactIdList ??
              (dashboardToEdit as Record<string, unknown>).pk_impact_id_list ??
              (dashboardToEdit as Record<string, unknown>).pkImpactIds,
          )
            .map((id) => Number(id))
            .filter((id) => !isNaN(id) && id > 0);

          if (rawImpactIds.length > 0) {
            const initialMap = new Map<number, RiskSearchResult>();
            rawImpactIds.forEach((pkId) => {
              initialMap.set(pkId, {
                pkImpactId: pkId,
                riskId: String(pkId),
                riskTitle: `Impact Item #${pkId}`,
                riskStatus: 'Active',
                riskType: 'Risk',
                riskScore: 0,
              });
            });
            setSelectedRisksMap(initialMap);
          } else {
            setSelectedRisksMap(new Map());
          }
        } else {
          resetForm();
        }
      }
    } else {
      isInitializedRef.current = false;
    }
  }, [open, dashboardToEdit, currentUserEmail, allUsers, mode]);

  /* Permissions-only: the access popover is the whole point, open it directly. */
  useEffect(() => {
    if (open && isPermissionsOnly) setOpenAccessPopover(true);
  }, [open, isPermissionsOnly]);

  /* Seed the perimeter from the source payload once it is loaded (authoritative, includes closed risks). */
  useEffect(() => {
    if (!open || perimeterSeededRef.current || sourcePayload.status !== 'ready') return;
    perimeterSeededRef.current = true;
    setSelectedRisksMap((prev) => {
      const next = mode === 'create' ? new Map<number, RiskSearchResult>() : new Map(prev);
      sourcePayload.perimeter.forEach((r) => {
        const existing = next.get(r.pkImpactId);
        // Replace "Impact Item #id" placeholders with real data, keep richer search results
        if (!existing || existing.riskTitle?.startsWith('Impact Item #')) next.set(r.pkImpactId, r);
      });
      return next;
    });
  }, [open, sourcePayload, mode]);

  /* Template picked: prefill metadata from it and re-seed perimeter + settings. */
  useEffect(() => {
    if (mode !== 'create' || !basedOnDashboard) return;
    perimeterSeededRef.current = false;
    setBoardTitle((t) => t || `${basedOnDashboard.boardTitle || ''} (copy)`);
    setReportType(basedOnDashboard.reportType || 'Report');
    setSelectedSiglums((prev) =>
      prev.length > 0
        ? prev
        : (basedOnDashboard.ownerDashboard || '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
    );
  }, [mode, basedOnDashboard]);

  const handleToggleRiskSelection = (risk: RiskSearchResult) => {
    setSelectedRisksMap((prev) => {
      const next = new Map(prev);
      if (next.has(risk.pkImpactId)) {
        next.delete(risk.pkImpactId);
      } else {
        next.set(risk.pkImpactId, risk);
      }
      return next;
    });
  };

  const handleToggleSelectAllVisible = (searchResults: RiskSearchResult[]) => {
    const allSelected = searchResults.length > 0 && searchResults.every((r) => selectedRisksMap.has(r.pkImpactId));
    setSelectedRisksMap((prev) => {
      const next = new Map(prev);
      searchResults.forEach((r) => {
        if (allSelected) {
          next.delete(r.pkImpactId);
        } else {
          next.set(r.pkImpactId, r);
        }
      });
      return next;
    });
  };

  const needsSourcePayload = Boolean(sourceProviderId);
  const isSourceLoading = needsSourcePayload && sourcePayload.status === 'loading';
  const sourceError = needsSourcePayload && sourcePayload.status === 'error' ? (sourcePayload.error ?? 'Unknown error') : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!boardTitle.trim()) {
      setErrorMessage('Dashboard title is required.');
      return;
    }

    if (selectedSiglums.length === 0) {
      setErrorMessage('Please select at least one Siglum owner.');
      return;
    }

    if (isSourceLoading) {
      setErrorMessage('Still loading the source dashboard. Please wait a moment.');
      return;
    }
    if (sourceError) {
      setErrorMessage(`Could not load the source dashboard: ${sourceError}`);
      return;
    }
    if (isEditMode && !targetIdentity) {
      setErrorMessage('Could not determine the dashboard identity (creation date / version). Please reload.');
      return;
    }
    // An existing dashboard must keep its own settings; refuse rather than overwrite with defaults.
    if (mode !== 'create' && !sourceSettings) {
      setErrorMessage('The dashboard settings could not be loaded, so saving was blocked to protect its layout.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const selectedImpactIds = Array.from(selectedRisksMap.keys())
        .map((id) => Number(id))
        .filter((id) => !isNaN(id) && id > 0);

      const finalReadEmails = resolveToUserEmails(selectedReaders, allUsers);
      const finalWriteEmails = resolveToUserEmails(selectedWriters, allUsers);
      const ownerBase = resolveToUserEmails(selectedOwners, allUsers);
      // Creators always own what they create; on edit, owners are kept as chosen.
      const finalOwnerEmails = isNewRecord ? Array.from(new Set([...ownerBase, currentUserEmail])) : ownerBase;

      if (finalOwnerEmails.length === 0) {
        setErrorMessage('A dashboard needs at least one owner.');
        setIsSubmitting(false);
        return;
      }

      // Read-permission cascade on risks / mitigations / waterfalls: only real changes are sent.
      const delta =
        mode === 'create'
          ? { added: [], removed: [] }
          : computePermissionDelta(initialMembersRef.current, [
              ...finalReadEmails,
              ...finalWriteEmails,
              ...finalOwnerEmails,
            ]);

      const target = mode === 'create' ? { epoch: Date.now(), version: 1, iteration: 1 } : targetIdentity!;
      const basedOn = mode === 'create' ? getDashboardIdentity(basedOnDashboard) : sourceIdentity;
      const settings =
        mode === 'create' ? (basedOnDashboard ? sourceSettings : '') || JSON.stringify(DEFAULT_NEUTRAL_SETTINGS) : sourceSettings;

      await client(executeAddEditWorkflow).applyAction({
        userMail: currentUserEmail,
        actionType: ACTION_TYPE[mode],
        env: 'master',
        creationDate: target.epoch,
        boardVersion: target.version,
        boardIteration: target.iteration,
        ownerDashboard: selectedSiglums,
        pkImpactIdList: selectedImpactIds,
        actionList: [],
        permissionsToAdd: delta.added,
        permissionsToRemove: delta.removed,
        permissionsReadNames: finalReadEmails,
        permissionsWriteNames: finalWriteEmails,
        permissionsOwnerNames: finalOwnerEmails,
        boardTitle: boardTitle.trim(),
        // A new iteration / version starts unlocked and active
        boardStatus: isNewRecord ? 'Active' : boardStatus,
        reportType: reportType,
        settings,
        validation: false,
        ...(basedOn && mode !== 'edit' && mode !== 'permissions'
          ? {
              creationDateBasedOn: basedOn.epoch,
              boardVersionBasedOn: basedOn.version,
              boardIterationBasedOn: basedOn.iteration,
            }
          : {}),
      });

      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      console.error(`Dashboard ${mode} failed:`, err);
      setErrorMessage(errorObj?.message || 'Saving the dashboard failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedRisksArray = useMemo(() => Array.from(selectedRisksMap.values()), [selectedRisksMap]);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(val) => {
          onOpenChange(val);
          if (!val) resetForm();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-350! w-[95vw]! h-[92vh] flex flex-col p-0 gap-0 overflow-hidden bg-slate-50 border border-slate-200 shadow-2xl"
        >
          <div className="bg-white p-4 border-b border-slate-200 shrink-0 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-xl font-bold text-airbus-navy">
                  {DIALOG_TITLE[mode]}
                  {sourceLabel && mode !== 'create' && (
                    <span className="ml-2 text-sm font-medium text-slate-500">
                      {mode === 'iteration' || mode === 'version' ? `${sourceLabel} → ${targetLabel}` : sourceLabel}
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">{DIALOG_DESCRIPTION[mode]}</DialogDescription>
              </div>

              <div className="flex items-center gap-3">
                <Popover open={openAccessPopover} onOpenChange={setOpenAccessPopover}>
                  <PopoverTrigger className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-background px-2.5 text-xs font-medium text-airbus-navy gap-1.5 cursor-pointer hover:bg-slate-100">
                    <Shield className="h-3.5 w-3.5 text-airbus-blue" /> Access Management
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-3 space-y-3" align="end">
                    <h4 className="font-semibold text-xs text-airbus-navy border-b pb-1">
                      Dashboard Access Permissions
                    </h4>
                    {!canEditAccess && (
                      <p className="text-[11px] text-slate-500">Only owners and officers can change access.</p>
                    )}
                    <div className={cn('space-y-2', !canEditAccess && 'pointer-events-none opacity-60')}>
                      <div>
                        <label className="text-[11px] font-medium text-slate-600">Readers</label>
                        <UserMultiSelect
                          users={allUsers}
                          selected={selectedReaders}
                          setSelected={setSelectedReaders}
                          placeholder="Select readers..."
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-slate-600">Writers</label>
                        <UserMultiSelect
                          users={allUsers}
                          selected={selectedWriters}
                          setSelected={setSelectedWriters}
                          placeholder="Select writers..."
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-slate-600">Owners</label>
                        <UserMultiSelect
                          users={allUsers}
                          selected={selectedOwners}
                          setSelected={setSelectedOwners}
                          placeholder="Select owners..."
                        />
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                {mode === 'create' && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>Report based on :</span>
                    <Select value={basedOnKey} onValueChange={(val) => setBasedOnKey(val ?? 'none')}>
                      <SelectTrigger className="h-8 w-56 text-xs bg-white">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value="none">None (start from scratch)</SelectItem>
                        {templateOptions.map(({ dash, id }) => (
                          <SelectItem key={id.key} value={id.key} className="text-xs">
                            {dash.boardTitle} (V{id.version}.{id.iteration})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-12 gap-3 items-end pt-1">
              <div className="col-span-3 space-y-1">
                <label className="text-[11px] font-semibold text-slate-700">Dashboard Name</label>
                <Input
                  placeholder="Enter dashboard title..."
                  value={boardTitle}
                  onChange={(e) => setBoardTitle(e.target.value)}
                  disabled={isPermissionsOnly}
                  className="h-8 text-xs bg-white"
                />
              </div>

              <div className="col-span-2 space-y-1">
                <label className="text-[11px] font-semibold text-slate-700">
                  Type <span className="text-red-500">*</span>
                </label>
                <Select value={reportType} onValueChange={(val) => setReportType(val ?? 'Report')} disabled={isPermissionsOnly}>
                  <SelectTrigger className="h-8 text-xs bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Report">Report</SelectItem>
                    <SelectItem value="Analysis">Analysis</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-1 space-y-1">
                <label className="text-[11px] font-semibold text-slate-700">Status</label>
                <Badge className="h-8 w-full justify-center bg-airbus-light text-airbus-blue border-airbus-blue/20 font-medium">
                  {isNewRecord ? 'Active' : boardStatus}
                </Badge>
              </div>

              <div className="col-span-2 space-y-1">
                <label className="text-[11px] font-semibold text-slate-700">
                  Siglum Owner <span className="text-red-500">*</span>
                </label>
                <Popover open={openSiglumCombo && !isPermissionsOnly} onOpenChange={setOpenSiglumCombo}>
                  <PopoverTrigger
                    disabled={isPermissionsOnly}
                    className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-white px-2.5 text-xs font-normal outline-none hover:bg-slate-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="truncate">
                      {selectedSiglums.length > 0 ? selectedSiglums.join(', ') : 'Enter the siglums owner'}
                    </span>
                    <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50 ml-1" />
                  </PopoverTrigger>
                  <PopoverContent className="w-55 p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search siglum..." className="h-8 text-xs" />
                      <CommandList>
                        <CommandEmpty className="py-2 text-center text-xs">No siglum found.</CommandEmpty>
                        <CommandGroup className="max-h-40 overflow-y-auto">
                          {combinedSiglums.map((siglum) => (
                            <CommandItem
                              key={siglum}
                              value={siglum}
                              onSelect={() => {
                                setSelectedSiglums((prev) =>
                                  prev.includes(siglum) ? prev.filter((s) => s !== siglum) : [...prev, siglum],
                                );
                              }}
                              className="text-xs cursor-pointer"
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-3 w-3',
                                  selectedSiglums.includes(siglum) ? 'opacity-100' : 'opacity-0',
                                )}
                              />
                              {siglum}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="col-span-2 space-y-1">
                <label className="text-[11px] font-semibold text-slate-700">Creation date</label>
                <div className="h-8 flex items-center px-2.5 bg-slate-100 text-xs text-slate-600 rounded-md border border-slate-200">
                  {mode !== 'create' && dashboardToEdit?.creationDate ? dashboardToEdit.creationDate : nowFormatted}
                </div>
              </div>

              <div className="col-span-2 space-y-1">
                <label className="text-[11px] font-semibold text-slate-700">Last edit date</label>
                <div className="h-8 flex items-center px-2.5 bg-slate-100 text-xs text-slate-600 rounded-md border border-slate-200">
                  {nowFormatted}
                </div>
              </div>
            </div>
          </div>

          <LifecycleBanner
            mode={mode}
            sourceLabel={sourceLabel}
            targetLabel={targetLabel}
            isLocked={isDashboardLocked(dashboardToEdit)}
            isSourceLoading={isSourceLoading}
            sourceError={sourceError}
            basedOnTitle={basedOnDashboard?.boardTitle}
          />

          <div className="bg-slate-200/70 border-b border-slate-300 flex items-center px-4 pt-1 shrink-0 gap-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setActiveTab('selected')}
              className={cn(
                'px-4 py-2 text-xs font-semibold rounded-t-md rounded-b-none transition-colors flex items-center gap-2 border-t border-x cursor-pointer h-auto',
                activeTab === 'selected'
                  ? 'bg-white text-airbus-navy border-slate-300 shadow-xs'
                  : 'text-slate-600 hover:text-airbus-navy border-transparent',
              )}
            >
              <span>☰ Risks / Opportunities List ({selectedRisksMap.size})</span>
            </Button>

            {!isPermissionsOnly && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setActiveTab('search')}
              className={cn(
                'px-4 py-2 text-xs font-semibold rounded-t-md rounded-b-none transition-colors flex items-center gap-2 border-t border-x cursor-pointer h-auto',
                activeTab === 'search'
                  ? 'bg-white text-airbus-navy border-slate-300 shadow-xs'
                  : 'text-slate-600 hover:text-airbus-navy border-transparent',
              )}
            >
              <Search className="h-3.5 w-3.5 text-airbus-blue" />
              <span>Search Risks and Opportunities</span>
            </Button>
            )}

            {!isPermissionsOnly && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setActiveTab('roShared')}
              className={cn(
                'px-4 py-2 text-xs font-semibold rounded-t-md rounded-b-none transition-colors flex items-center gap-2 border-t border-x cursor-pointer h-auto',
                activeTab === 'roShared'
                  ? 'bg-white text-airbus-navy border-slate-300 shadow-xs'
                  : 'text-slate-600 hover:text-airbus-navy border-transparent',
              )}
            >
              <Share2 className="h-3.5 w-3.5 text-airbus-blue" />
              <span>R&O Shared</span>
            </Button>
            )}
          </div>

          <div className="flex-1 overflow-hidden flex flex-col relative">
            {!isPermissionsOnly && (
            <div className={cn('flex-1 flex flex-col overflow-hidden', activeTab !== 'search' && 'hidden')}>
              <RiskSearchPanel
                selectedRisksMap={selectedRisksMap}
                setSelectedRisksMap={setSelectedRisksMap}
                onToggleRiskSelection={handleToggleRiskSelection}
                onToggleSelectAllVisible={handleToggleSelectAllVisible}
                dashboardId={isEditMode ? effectiveDashboardId : undefined}
                onSearchingChange={setIsSearchingRisks}
              />
            </div>
            )}

            <div
              className={cn('flex-1 flex flex-col overflow-hidden bg-white p-4', activeTab !== 'roShared' && 'hidden')}
            >
              <DashboardRoSharedPanel
                currentUserEmail={currentUserEmail}
                dashboardKey={currentDashboardKey}
                onOpenAddRiskToReport={(item) => setAddRiskToReportItem(item)}
              />
            </div>

            <div className={cn('flex-1 bg-white p-4 overflow-auto', activeTab !== 'selected' && 'hidden')}>
              {isSearchingRisks || (isSourceLoading && selectedRisksArray.length === 0) ? (
                <div className="flex items-center justify-center h-48 text-airbus-navy font-medium text-xs">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Fetching risks...
                </div>
              ) : selectedRisksArray.length > 0 ? (
                <Table className="text-xs table-fixed w-full">
                  <TableHeader className="bg-slate-50 sticky top-0 z-10 shadow-xs">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-24 py-2.5 px-2 font-semibold text-airbus-navy">ID</TableHead>
                      <TableHead className="w-24 py-2.5 px-2 font-semibold text-airbus-navy">Type</TableHead>
                      <TableHead className="w-28 py-2.5 px-2 font-semibold text-airbus-navy">Siglum Owner</TableHead>
                      <TableHead className="w-1/3 py-2.5 px-2 font-semibold text-airbus-navy">Title</TableHead>
                      <TableHead className="py-2.5 px-2 font-semibold text-airbus-navy">Description</TableHead>
                      <TableHead className="w-24 text-center py-2.5 px-2 font-semibold text-airbus-navy">
                        Status
                      </TableHead>
                      <TableHead className="w-24 text-center py-2.5 px-2 font-semibold text-airbus-navy">
                        Criticality
                      </TableHead>
                      <TableHead className="w-20 text-right py-2.5 px-2 font-semibold text-airbus-navy">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRisksArray.map((risk) => {
                      const titleText = risk.riskTitle || '-';
                      const descText = risk.riskDescription || '-';
                      const isNegative = (risk.riskScore ?? 0) < 0;
                      const isOpportunity = risk.riskType?.toLowerCase() === 'opportunity';

                      return (
                        <TableRow key={risk.pkImpactId} className="hover:bg-slate-50 transition-colors">
                          <TableCell
                            className="p-2 font-mono font-medium text-airbus-navy truncate"
                            title={risk.riskId}
                          >
                            {risk.riskId}
                          </TableCell>

                          <TableCell className="p-2 truncate">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] px-1.5 py-0',
                                isOpportunity
                                  ? 'border-blue-300 text-blue-600 bg-blue-50'
                                  : 'border-red-300 text-red-600 bg-red-50',
                              )}
                            >
                              {risk.riskType || 'Risk'}
                            </Badge>
                          </TableCell>

                          <TableCell
                            className="p-2 font-medium text-slate-700 truncate"
                            title={risk.siglumOwner || '-'}
                          >
                            {risk.siglumOwner || '-'}
                          </TableCell>

                          <TableCell className="p-2 font-semibold text-airbus-navy max-w-0 truncate" title={titleText}>
                            {titleText}
                          </TableCell>

                          <TableCell className="p-2 text-slate-600 max-w-0 truncate" title={descText}>
                            {descText}
                          </TableCell>

                          <TableCell className="p-2 text-center">
                            <Badge className="text-[10px] px-1.5 py-0 bg-airbus-light text-airbus-blue font-medium border border-airbus-blue/20">
                              {risk.riskStatus || 'Active'}
                            </Badge>
                          </TableCell>

                          <TableCell className="p-2 text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                'font-mono text-[10px] px-1.5 py-0',
                                isNegative
                                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                                  : 'bg-orange-50 border-orange-200 text-orange-700',
                              )}
                            >
                              {getScoreCode(risk.riskScore)}
                            </Badge>
                          </TableCell>

                          <TableCell className="p-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => setSharingRiskItem(risk)}
                                title="Share / Escalate Risk"
                                className="text-airbus-blue hover:text-airbus-navy cursor-pointer"
                              >
                                <Share2 className="h-3.5 w-3.5" />
                              </Button>

                              {!isPermissionsOnly && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => handleToggleRiskSelection(risk)}
                                title="Remove from dashboard"
                                className="text-slate-400 hover:text-red-500 cursor-pointer"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-12 text-center text-slate-400 text-xs">
                  No risks selected yet. Switch to the &quot;Search Risks and Opportunities&quot; tab to select items
                  for this dashboard.
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="bg-white border-t border-slate-200 flex items-center justify-between shrink-0 px-6 py-3.5 m-0 rounded-b-xl">
            {errorMessage ? (
              <div className="text-xs text-red-600 font-medium">{errorMessage}</div>
            ) : (
              <div className="text-xs text-slate-500">
                Selected Items: <strong className="text-airbus-navy">{selectedRisksMap.size}</strong>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
                className="h-8 text-xs px-4"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSubmit}
                className="h-8 text-xs px-4 bg-airbus-navy hover:bg-airbus-blue text-white shadow-sm cursor-pointer"
                disabled={isSubmitting || isSourceLoading || Boolean(sourceError)}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> {isNewRecord ? 'Creating...' : 'Saving...'}
                  </>
                ) : isSourceLoading ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading dashboard...
                  </>
                ) : mode === 'iteration' ? (
                  `Create iteration ${targetLabel}`
                ) : mode === 'version' ? (
                  `Create version ${targetLabel}`
                ) : mode === 'permissions' ? (
                  'Save Permissions'
                ) : isEditMode ? (
                  'Save Changes'
                ) : (
                  'Save & Create Dashboard'
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RiskEscalationSharingDialog
        open={Boolean(sharingRiskItem)}
        onOpenChange={(val) => {
          if (!val) setSharingRiskItem(null);
        }}
        riskItem={sharingRiskItem}
        currentDashboard={dashboardToEdit}
        allDashboards={allDashboards}
        allUsers={allUsers}
        currentUserEmail={currentUserEmail}
      />

      {/* Loads the source dashboard's settings + perimeter only when there is one */}
      {open && sourceProviderId && (
        <DashboardProvider key={sourceProviderId} dashboardId={sourceProviderId} currentUserEmail={currentUserEmail}>
          <SourcePayloadBridge onChange={handleSourcePayload} />
        </DashboardProvider>
      )}

      <AddRiskToReportDialog
        open={Boolean(addRiskToReportItem)}
        onOpenChange={(val) => {
          if (!val) setAddRiskToReportItem(null);
        }}
        item={addRiskToReportItem}
        dashboards={allDashboards}
        currentUserEmail={currentUserEmail}
        onSuccess={() => onSuccess()}
        defaultDashboardKey={currentDashboardKey}
      />
    </>
  );
};

const DIALOG_TITLE: Record<DashboardDialogMode, string> = {
  create: 'ERM Cockpit',
  edit: 'Edit Dashboard',
  iteration: 'New Iteration',
  version: 'New Version',
  permissions: 'Edit Permissions',
};

const DIALOG_DESCRIPTION: Record<DashboardDialogMode, string> = {
  create: 'Create, manage and share dashboard for reporting risks and opportunities within your activities',
  edit: 'Modify settings, permissions, and risk perimeters for this dashboard',
  iteration: 'This dashboard is locked. Your changes are saved as a new iteration; the validated one stays untouched.',
  version: 'Start a new major version of this dashboard, pre-filled from the current one',
  permissions: 'Only access management can be changed on a locked or older version of a dashboard',
};

function LifecycleBanner({
  mode,
  sourceLabel,
  targetLabel,
  isLocked,
  isSourceLoading,
  sourceError,
  basedOnTitle,
}: {
  mode: DashboardDialogMode;
  sourceLabel: string;
  targetLabel: string;
  isLocked: boolean;
  isSourceLoading: boolean;
  sourceError: string | null;
  basedOnTitle?: string;
}) {
  let icon = <Info className="h-3.5 w-3.5 shrink-0" />;
  let tone = 'bg-blue-50 border-blue-200 text-blue-900';
  let text: React.ReactNode = null;

  if (sourceError) {
    tone = 'bg-red-50 border-red-200 text-red-800';
    text = <>Could not load the source dashboard ({sourceError}). Saving is disabled to avoid losing its content.</>;
  } else if (mode === 'iteration') {
    icon = <Lock className="h-3.5 w-3.5 shrink-0" />;
    tone = 'bg-amber-50 border-amber-200 text-amber-900';
    text = (
      <>
        <strong>{sourceLabel}</strong> is {isLocked ? 'validated / locked' : 'locked'}. Saving creates{' '}
        <strong>{targetLabel}</strong> with your changes, including comments and top-risk flags carried over.
      </>
    );
  } else if (mode === 'version') {
    icon = <GitBranch className="h-3.5 w-3.5 shrink-0" />;
    text = (
      <>
        Creates new major version <strong>{targetLabel}</strong> from <strong>{sourceLabel}</strong> (settings,
        perimeter, permissions and risk comments are copied).
      </>
    );
  } else if (mode === 'permissions') {
    icon = <Lock className="h-3.5 w-3.5 shrink-0" />;
    tone = 'bg-slate-100 border-slate-300 text-slate-700';
    text = <>Only readers, writers and owners can be changed here. Open Access Management at the top right.</>;
  } else if (mode === 'create' && basedOnTitle) {
    text = (
      <>
        Based on <strong>{basedOnTitle}</strong>: its settings and risk perimeter are pre-loaded. The new dashboard
        starts at V1.1.
      </>
    );
  }

  if (!text && !isSourceLoading) return null;
  return (
    <div className={cn('mx-4 mt-2 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs', tone)}>
      {isSourceLoading && !sourceError ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : icon}
      <span>{text ?? 'Loading the source dashboard settings and risk perimeter…'}</span>
    </div>
  );
}

function DashboardRoSharedPanel({
  currentUserEmail,
  dashboardKey,
  onOpenAddRiskToReport,
}: {
  currentUserEmail: string;
  dashboardKey?: string;
  onOpenAddRiskToReport: (_item: ProcessedSharingItem) => void;
}) {
  const { data, isLoading } = useRiskSharings(currentUserEmail, 'dashboardView', dashboardKey);

  const sharedItems: ProcessedSharingItem[] = useMemo(() => {
    return (data && (data['inside_sharing_dashboard'] || data['outside_sharing_dashboard'])) || [];
  }, [data]);

  const escalatedItems: ProcessedSharingItem[] = useMemo(() => {
    return (data && (data['inside_escalation_dashboard'] || data['outside_escalation_dashboard'])) || [];
  }, [data]);

  const [isSharedOpen, setIsSharedOpen] = useState(true);
  const [isEscalatedOpen, setIsEscalatedOpen] = useState(true);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-slate-500 font-medium">
        <Loader2 className="h-4 w-4 animate-spin mr-2 text-airbus-blue" /> Loading dashboard sharings...
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white p-4 overflow-auto space-y-4 text-xs">
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <div
          onClick={() => setIsSharedOpen(!isSharedOpen)}
          className="flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100/80 cursor-pointer select-none border-b border-slate-200 transition-colors"
        >
          <div className="flex items-center gap-2 font-semibold text-airbus-navy">
            {isSharedOpen ? (
              <ChevronDown className="h-4 w-4 text-slate-500" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-500" />
            )}
            <span>Shared with my dashboards ({sharedItems.length})</span>
          </div>
        </div>

        {isSharedOpen && (
          <div className="p-2">
            {sharedItems.length > 0 ? (
              <SharingTable items={sharedItems} onOpenAddRiskToReport={onOpenAddRiskToReport} />
            ) : (
              <div className="py-6 text-center text-slate-400">No risks shared with dashboards.</div>
            )}
          </div>
        )}
      </div>

      <div className="border border-slate-200 rounded-md overflow-hidden">
        <div
          onClick={() => setIsEscalatedOpen(!isEscalatedOpen)}
          className="flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100/80 cursor-pointer select-none border-b border-slate-200 transition-colors"
        >
          <div className="flex items-center gap-2 font-semibold text-airbus-navy">
            {isEscalatedOpen ? (
              <ChevronDown className="h-4 w-4 text-slate-500" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-500" />
            )}
            <span>Escalated with my dashboards ({escalatedItems.length})</span>
          </div>
        </div>

        {isEscalatedOpen && (
          <div className="p-2">
            {escalatedItems.length > 0 ? (
              <SharingTable items={escalatedItems} onOpenAddRiskToReport={onOpenAddRiskToReport} />
            ) : (
              <div className="py-6 text-center text-slate-400">No risks escalated with dashboards.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SharingTable({
  items,
  onOpenAddRiskToReport,
}: {
  items: ProcessedSharingItem[];
  onOpenAddRiskToReport: (_item: ProcessedSharingItem) => void;
}) {
  return (
    <Table className="text-xs">
      <TableHeader className="bg-slate-50/60">
        <TableRow>
          <TableHead className="w-24">Item ID</TableHead>
          <TableHead className="w-20">Type</TableHead>
          <TableHead className="w-28">Siglum Owner</TableHead>
          <TableHead className="w-1/3">Title</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="w-20">Status</TableHead>
          <TableHead className="w-20 text-center">Criticality</TableHead>
          <TableHead className="w-16 text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, idx) => {
          const isOpportunity =
            item.type?.toLowerCase().includes('opportunity') || item.type?.toLowerCase().includes('opp');

          return (
            <TableRow key={idx} className="hover:bg-slate-50">
              <TableCell className="font-mono font-semibold text-slate-700">{item.riskIdRaw || '-'}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] px-1.5 py-0 font-medium border',
                    isOpportunity
                      ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                      : 'border-red-300 text-red-600 bg-red-50/50',
                  )}
                >
                  {item.type || (isOpportunity ? 'Opportunity' : 'Risk')}
                </Badge>
              </TableCell>
              <TableCell className="font-medium text-slate-700">{item.siglumOwner || '-'}</TableCell>
              <TableCell className="font-semibold text-airbus-navy max-w-xs truncate" title={item.title}>
                {item.title || '-'}
              </TableCell>
              <TableCell className="text-slate-600 max-w-sm truncate" title={item.description}>
                {item.description || '-'}
              </TableCell>
              <TableCell>{item.status || '-'}</TableCell>
              <TableCell className="text-center">
                <Badge
                  variant="outline"
                  className={cn(
                    'font-mono text-[10px] px-1.5 py-0',
                    item.scoreCss === 'very-high'
                      ? 'bg-red-50 border-red-300 text-red-700'
                      : item.scoreCss === 'high'
                        ? 'bg-orange-50 border-orange-300 text-orange-700'
                        : 'bg-amber-50 border-amber-300 text-amber-700',
                  )}
                >
                  {item.scoreDisplay || '-'}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onOpenAddRiskToReport(item)}
                  title="Add Risk to Report(s)"
                  className="text-airbus-blue hover:text-airbus-navy hover:bg-slate-100 cursor-pointer"
                >
                  <PlusCircle className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function UserMultiSelect({
  users,
  selected,
  setSelected,
  placeholder,
}: {
  users: FormattedUser[];
  selected: string[];
  setSelected: (_vals: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);

  const isUserSelected = (user: FormattedUser) => {
    const keyLower = user.key.toLowerCase();
    const displayLower = user.key_display.toLowerCase();
    return selected.some((s) => {
      const sLower = String(s).toLowerCase().trim();
      return sLower === keyLower || sLower === displayLower;
    });
  };

  const sortedUsers = useMemo(() => {
    const selectedUsers: FormattedUser[] = [];
    const otherUsers: FormattedUser[] = [];

    users.forEach((user) => {
      if (isUserSelected(user)) {
        selectedUsers.push(user);
      } else {
        otherUsers.push(user);
      }
    });

    return [...selectedUsers, ...otherUsers];
  }, [users, selected]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-white px-2.5 text-xs font-normal outline-none hover:bg-slate-50 cursor-pointer">
        <span className="truncate">{selected.length > 0 ? `${selected.length} user(s) selected` : placeholder}</span>
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50 ml-1" />
      </PopoverTrigger>
      <PopoverContent className="w-70 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search user..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-2 text-center text-xs">No user found.</CommandEmpty>
            <CommandGroup className="max-h-40 overflow-y-auto">
              {sortedUsers.map((user) => {
                const checked = isUserSelected(user);
                return (
                  <CommandItem
                    key={user.key}
                    value={`${user.key_display} ${user.key}`}
                    onSelect={() => {
                      if (checked) {
                        const keyLower = user.key.toLowerCase();
                        const displayLower = user.key_display.toLowerCase();
                        setSelected(
                          selected.filter((s) => {
                            const sLower = String(s).toLowerCase().trim();
                            return sLower !== keyLower && sLower !== displayLower;
                          }),
                        );
                      } else {
                        setSelected([...selected, user.key]);
                      }
                    }}
                    className="text-xs cursor-pointer"
                  >
                    <Check className={cn('mr-2 h-3 w-3', checked ? 'opacity-100' : 'opacity-0')} />
                    {user.key_display}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}




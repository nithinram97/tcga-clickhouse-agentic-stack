import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Printer,
  Save,
  Settings,
} from 'lucide-react';
import { ermEditDashboardSettingsv2, ermGetSummaryTabData } from '@fca0-enterprise-risk-management/sdk';
import { useDashboardContext, type ArmRiskRow } from '../../context/DashboardContext';
import { client } from '../../client';
import { cn } from '../../../@/lib/utils';
import { Button } from '../../../@/components/ui/button';
import { Checkbox } from '../../../@/components/ui/checkbox';
import { Input } from '../../../@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../@/components/ui/dialog';
import type { SummaryTabData } from './DashboardSummaryTab';
import {
  asObj,
  filterPrintableActions,
  getActionParentPk,
  getRowDisplayId,
  getRowPk,
  getRowTitle,
  isOpportunityRow,
  isTopRiskRow,
  parseDashboardSettings,
  parseJsonObject,
  parseOnePagerPrintConfig,
  readCellValues,
  resolveMitigationColumns,
  resolveRiskTableColumns,
} from '../../utils/reportPrintUtils';
import { ReportPage, type ReportMeta } from './report/ReportPrimitives';
import { PrintMatrix } from './report/PrintMatrix';
import { RiskMetricsSection, RiskTableSection } from './report/PrintTables';
import { PrintOnePager } from './report/PrintOnePager';
import { RICH_HTML_CLASSES } from './report/reportStyles';

/* ------------------------------------------------------------------ */
/* Section model                                                       */
/* ------------------------------------------------------------------ */

export type ReportSectionKey =
  | 'execSummary'
  | 'heatmap'
  | 'coldmap'
  | 'risksTable'
  | 'opportunitiesTable'
  | 'riskMetrics'
  | 'onePagers';

export interface ReportSectionConfig {
  key: ReportSectionKey;
  label: string;
  visible: boolean;
}

const DEFAULT_SECTIONS: ReportSectionConfig[] = [
  { key: 'execSummary', label: 'Exec Summary', visible: true },
  { key: 'heatmap', label: 'Heatmap', visible: true },
  { key: 'coldmap', label: 'Coldmap', visible: true },
  { key: 'risksTable', label: 'Risks Table', visible: true },
  { key: 'opportunitiesTable', label: 'Opportunities Table', visible: true },
  { key: 'riskMetrics', label: 'Risk Metrics', visible: true },
  { key: 'onePagers', label: 'OnePagers', visible: true },
];

function restoreSections(saved: unknown): ReportSectionConfig[] {
  if (!Array.isArray(saved)) return DEFAULT_SECTIONS;
  const byKey = new Map(DEFAULT_SECTIONS.map((s) => [s.key, s]));
  const out: ReportSectionConfig[] = [];
  saved.forEach((item) => {
    const o = asObj(item);
    const def = byKey.get(o.key as ReportSectionKey);
    if (def && !out.some((s) => s.key === def.key)) out.push({ ...def, visible: o.visible !== false });
  });
  DEFAULT_SECTIONS.forEach((d) => {
    if (!out.some((s) => s.key === d.key)) out.push(d);
  });
  return out;
}

/* Summary HTML page separators (TinyMCE pagebreak + legacy Slate separator) */
const PAGE_BREAK_REGEX =
  /<p>\s*<strong>\s*-{3,}\s*Page Separator \(Do Not Remove\)\s*-{3,}\s*<\/strong>\s*<\/p>|<strong>\s*-{3,}\s*Page Separator \(Do Not Remove\)\s*-{3,}\s*<\/strong>|<p>\s*-{3,}\s*Page Separator \(Do Not Remove\)\s*-{3,}\s*<\/p>|<!--\s*pagebreak\s*-->|<div[^>]*class="[^"]*mce-pagebreak[^"]*"[^>]*><\/div>|<img[^>]*class="[^"]*mce-pagebreak[^"]*"[^>]*>/gi;

const isEmptyHtml = (html: string) => !html.replace(/<[^>]*>|&nbsp;|\s/g, '').length && !/<img|<table/i.test(html);

const todayIso = () => new Date().toISOString().split('T')[0];

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export const DashboardReportTab: React.FC<{ dashboardId: string }> = ({ dashboardId }) => {
  const {
    allRiskRows,
    dashboardTitle,
    armRoPayload,
    currentUserEmail,
    refetchPayload,
    canEdit,
    isLoadingPayload,
    payloadError,
  } = useDashboardContext();

  /* ---------- Summary data (exec summary, comments, assumptions) ---------- */
  const [summary, setSummary] = useState<SummaryTabData | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setIsLoadingSummary(true);
        const res = await client(ermGetSummaryTabData).executeFunction({ dashboardId, currentUserEmail, env: 'master' });
        const parsed: SummaryTabData = typeof res === 'string' ? JSON.parse(res) : res;
        if (alive) setSummary(parsed);
      } catch (err) {
        console.error('Report: failed to fetch summary data', err);
      } finally {
        if (alive) setIsLoadingSummary(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dashboardId, currentUserEmail]);

  /* ---------- Settings ---------- */
  const settings = useMemo(() => parseDashboardSettings(armRoPayload?.settings), [armRoPayload]);
  const printOpts = useMemo(() => asObj(settings.print_options), [settings]);

  const [sections, setSections] = useState<ReportSectionConfig[]>(DEFAULT_SECTIONS);
  const [showCover, setShowCover] = useState(true);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [displayMode, setDisplayMode] = useState<'Id' | 'Title'>('Id');
  const [excludedPks, setExcludedPks] = useState<Set<number>>(new Set());

  const [printTitle, setPrintTitle] = useState('');
  const [printSubtitle, setPrintSubtitle] = useState('');
  const [classification, setClassification] = useState('Airbus Amber');
  const [footerText, setFooterText] = useState('');
  const [footerDate, setFooterDate] = useState(todayIso());
  const [rowsPerPage, setRowsPerPage] = useState(15);

  useEffect(() => {
    setPrintTitle(String(printOpts.title || dashboardTitle || dashboardId));
    setPrintSubtitle(String(printOpts.subtitle ?? ''));
    setClassification(String(printOpts.classification || 'Airbus Amber'));
    setFooterText(String(printOpts.editable_text ?? 'Airbus Internal'));
    setFooterDate(String(printOpts.editable_date || todayIso()));
    setRowsPerPage(Number(printOpts.number_ro_report_table) || 15);
    setSections(restoreSections(printOpts.sections));
    setShowCover(printOpts.cover !== false);
    setIncludeChildren(Boolean(printOpts.print_children));
    setDisplayMode(printOpts.display_mode === 'Title' ? 'Title' : 'Id');
    setExcludedPks(
      new Set(Array.isArray(printOpts.onepager_excluded) ? printOpts.onepager_excluded.map(Number) : []),
    );
  }, [printOpts, dashboardTitle, dashboardId]);

  const meta: ReportMeta = useMemo(
    () => ({ title: printTitle, subtitle: printSubtitle, classification, footerText, footerDate }),
    [printTitle, printSubtitle, classification, footerText, footerDate],
  );

  /* ---------- Data ---------- */
  const risks = useMemo(() => allRiskRows.filter((r) => !isOpportunityRow(r)), [allRiskRows]);
  const opps = useMemo(() => allRiskRows.filter(isOpportunityRow), [allRiskRows]);

  const riskColumns = useMemo(() => resolveRiskTableColumns(settings), [settings]);
  const riskCellValues = useMemo(() => readCellValues(settings.report_table?.value), [settings]);

  const idByPk = useMemo(() => {
    const m = new Map<number, string>();
    allRiskRows.forEach((r) => m.set(getRowPk(r), getRowDisplayId(r)));
    return m;
  }, [allRiskRows]);

  const actions = useMemo(() => {
    const raw = Object.values(armRoPayload?.mitigation_rows || {});
    return filterPrintableActions(raw, settings).filter((a) => idByPk.has(getActionParentPk(a)));
  }, [armRoPayload, settings, idByPk]);
  const actionColumns = useMemo(() => resolveMitigationColumns(settings), [settings]);
  const actionCellValues = useMemo(() => readCellValues(asObj(settings.action_tracker_table).value), [settings]);

  const onePagerRows = useMemo(
    () => [...risks, ...opps].filter((r) => !excludedPks.has(getRowPk(r))),
    [risks, opps, excludedPks],
  );

  const summaryPages = useMemo(() => {
    const html = summary?.execSummaryHtml || '';
    const chunks = html
      .split(PAGE_BREAK_REGEX)
      .map((c) => c.trim())
      .filter((c) => c && !isEmptyHtml(c));
    return chunks;
  }, [summary]);

  const assumptionDate = summary?.assumptionDateDisplay || summary?.execSummaryDateDisplay || '';

  /* ---------- Sidebar actions ---------- */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  /** `to` is the insertion slot (0..length) in the list before removal. */
  const moveSection = (from: number, to: number) => {
    setSections((prev) => {
      if (to === from || to === from + 1) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to > from ? to - 1 : to, 0, item);
      return next;
    });
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, idx: number) => {
    if (dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    setDropIndex(e.clientY < rect.top + rect.height / 2 ? idx : idx + 1);
  };

  const endDrag = () => {
    setDragIndex(null);
    setDropIndex(null);
  };
  const toggleSection = (key: ReportSectionKey) =>
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, visible: !s.visible } : s)));

  const togglePk = (pk: number) =>
    setExcludedPks((prev) => {
      const next = new Set(prev);
      if (next.has(pk)) next.delete(pk);
      else next.add(pk);
      return next;
    });

  const setGroupSelection = (rows: ArmRiskRow[], mode: 'all' | 'none' | 'top') =>
    setExcludedPks((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => {
        const pk = getRowPk(r);
        const include = mode === 'all' || (mode === 'top' && isTopRiskRow(r));
        if (include) next.delete(pk);
        else next.add(pk);
      });
      return next;
    });

  /* ---------- Save configuration ---------- */
  const [showSetup, setShowSetup] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      setFeedback(null);
      const existing = parseJsonObject(armRoPayload?.settings);
      const updated = {
        ...existing,
        print_options: {
          ...asObj(existing.print_options),
          title: printTitle,
          subtitle: printSubtitle,
          classification,
          editable_text: footerText,
          editable_date: footerDate,
          number_ro_report_table: rowsPerPage,
          cover: showCover,
          print_children: includeChildren,
          display_mode: displayMode,
          sections: sections.map(({ key, visible }) => ({ key, visible })),
          onepager_excluded: Array.from(excludedPks),
        },
      };
      await client(ermEditDashboardSettingsv2).applyAction({
        dashboardId,
        incomingSettings: JSON.stringify(updated),
        userMail: currentUserEmail,
        lastEditor: currentUserEmail,
        env: 'master',
      });
      await refetchPayload();
      setShowSetup(false);
      setFeedback({ type: 'success', text: 'Report configuration saved.' });
    } catch (err: unknown) {
      setFeedback({ type: 'error', text: (err as { message?: string })?.message || 'Failed to save report configuration.' });
    } finally {
      setIsSaving(false);
    }
  }, [
    armRoPayload,
    printTitle,
    printSubtitle,
    classification,
    footerText,
    footerDate,
    rowsPerPage,
    showCover,
    includeChildren,
    displayMode,
    sections,
    excludedPks,
    dashboardId,
    currentUserEmail,
    refetchPayload,
  ]);

  /* ---------- Print ---------- */
  const handlePrint = () => {
    const previousTitle = document.title;
    // Browsers use the document title as the default PDF file name
    document.title = `${printTitle || 'ERM Report'} - ${footerDate}`.replace(/[\\/:*?"<>|]/g, '-');
    const restore = () => {
      document.title = previousTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  };

  /* ---------- Render sections ---------- */
  const renderSection = (sec: ReportSectionConfig): React.ReactNode => {
    switch (sec.key) {
      case 'execSummary':
        if (summaryPages.length === 0) return null;
        return summaryPages.map((html, i) => (
          <ReportPage
            key={`exec-${i}`}
            meta={meta}
            heading={summaryPages.length > 1 ? `Executive Summary (${i + 1}/${summaryPages.length})` : 'Executive Summary'}
          >
            <div className={RICH_HTML_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
          </ReportPage>
        ));

      case 'heatmap':
        if (risks.length === 0) return null;
        return (
          <ReportPage key="heatmap" meta={meta} heading="Heatmap" headingRight={<CountTag n={risks.length} noun="risk" />}>
            <PrintMatrix
              type="Risk"
              rows={risks}
              displayMode={displayMode}
              commentsHtml={summary?.heatmapCommentsRisksHtml}
              assumptionHtml={summary?.assumptionHtml}
              assumptionDate={assumptionDate}
            />
          </ReportPage>
        );

      case 'coldmap':
        if (opps.length === 0) return null;
        return (
          <ReportPage key="coldmap" meta={meta} heading="Coldmap" headingRight={<CountTag n={opps.length} noun="opportunity" />}>
            <PrintMatrix
              type="Opportunity"
              rows={opps}
              displayMode={displayMode}
              commentsHtml={summary?.heatmapCommentsOpportunitiesHtml}
              assumptionHtml={summary?.assumptionHtml}
              assumptionDate={assumptionDate}
            />
          </ReportPage>
        );

      case 'risksTable':
        return (
          <RiskTableSection
            key="risksTable"
            meta={meta}
            type="Risk"
            rows={risks}
            columns={riskColumns}
            cellValues={riskCellValues}
            includeChildren={includeChildren}
            maxRowsPerPage={rowsPerPage}
          />
        );

      case 'opportunitiesTable':
        if (opps.length === 0) return null;
        return (
          <RiskTableSection
            key="opportunitiesTable"
            meta={meta}
            type="Opportunity"
            rows={opps}
            columns={riskColumns}
            cellValues={riskCellValues}
            includeChildren={includeChildren}
            maxRowsPerPage={rowsPerPage}
          />
        );

      case 'riskMetrics':
        return <RiskMetricsSection key="riskMetrics" meta={meta} risks={risks} opps={opps} />;

      case 'onePagers':
        return onePagerRows.map((risk) => (
          <PrintOnePager
            key={`op-${getRowPk(risk)}`}
            meta={meta}
            risk={risk}
            config={parseOnePagerPrintConfig(risk, armRoPayload?.settings)}
            actions={actions}
            actionColumns={actionColumns}
            actionCellValues={actionCellValues}
          />
        ));
    }
  };

  if (isLoadingPayload) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white text-xs font-medium text-airbus-navy">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Preparing report…
      </div>
    );
  }
  if (payloadError) {
    return <div className="flex flex-1 items-center justify-center bg-white text-xs font-medium text-red-600">{payloadError}</div>;
  }

  return (
    <div className="flex h-full w-full flex-1 overflow-hidden bg-slate-200">
      <style>{REPORT_CSS}</style>

      {/* ------------------------------ SIDEBAR ------------------------------ */}
      <aside className="flex h-full w-80 shrink-0 select-none flex-col border-r border-slate-300 bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-xs font-bold uppercase tracking-wider text-airbus-navy">Report builder</span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setShowSetup(true)}
            className="h-7 cursor-pointer gap-1 px-2 text-xs font-semibold text-airbus-navy hover:bg-slate-100"
          >
            <Settings className="h-3.5 w-3.5 text-airbus-blue" /> Setup
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 text-xs">
          {/* Options */}
          <div className="space-y-2">
            <SidebarLabel>Options</SidebarLabel>
            <CheckRow id="rpt-cover" checked={showCover} onChange={setShowCover} label="Cover page" />
            <CheckRow id="rpt-children" checked={includeChildren} onChange={setIncludeChildren} label="Print children in tables" />
            <div className="flex items-center justify-between pt-1">
              <span className="font-medium text-slate-700">Map labels</span>
              <div className="flex">
                {(['Id', 'Title'] as const).map((m, i) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDisplayMode(m)}
                    className={cn(
                      'cursor-pointer border px-2.5 py-0.5 text-[11px]',
                      i === 1 && 'border-l-0',
                      displayMode === m ? 'border-airbus-navy bg-airbus-navy font-bold text-white' : 'border-slate-300 bg-white text-slate-500',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sections */}
          <div className="space-y-2 border-t border-slate-200 pt-3">
            <SidebarLabel>Sections &amp; order</SidebarLabel>
            <p className="text-[10px] text-slate-400">Drag to reorder · click the eye to show or hide.</p>
            <div className="space-y-1" onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndex(null);
            }}>
              {sections.map((sec, idx) => (
                <div
                  key={sec.key}
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(idx);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', sec.key);
                  }}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null && dropIndex !== null) moveSection(dragIndex, dropIndex);
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                  className={cn(
                    'relative flex cursor-grab items-center gap-2 rounded border p-2 transition-colors active:cursor-grabbing',
                    sec.visible ? 'border-slate-200 bg-slate-50 text-slate-800' : 'border-transparent bg-slate-100/60 text-slate-400',
                    dragIndex === idx && 'opacity-40',
                  )}
                >
                  {/* Drop indicator */}
                  {dragIndex !== null && dropIndex === idx && (
                    <span className="pointer-events-none absolute -top-[3px] left-0 right-0 h-[2px] rounded bg-[#DA1884]" />
                  )}
                  {dragIndex !== null && idx === sections.length - 1 && dropIndex === sections.length && (
                    <span className="pointer-events-none absolute -bottom-[3px] left-0 right-0 h-[2px] rounded bg-[#DA1884]" />
                  )}

                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="flex-1 truncate font-semibold">
                    {sec.label}
                    {sec.key === 'onePagers' && <span className="ml-1 font-mono font-normal text-slate-400">({onePagerRows.length})</span>}
                  </span>
                  <IconBtn onClick={() => toggleSection(sec.key)}>
                    {sec.visible ? <Eye className="h-3.5 w-3.5 text-airbus-blue" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </IconBtn>
                </div>
              ))}
            </div>
          </div>

          {/* OnePager selection */}
          <div className="space-y-2 border-t border-slate-200 pt-3">
            <SidebarLabel>OnePagers</SidebarLabel>
            <OnePagerPicker label="Risks" rows={risks} excluded={excludedPks} onToggle={togglePk} onBulk={setGroupSelection} />
            <OnePagerPicker label="Opportunities" rows={opps} excluded={excludedPks} onToggle={togglePk} onBulk={setGroupSelection} />
          </div>
        </div>

        <div className="space-y-2 border-t border-slate-200 p-4">
          {feedback && (
            <div
              className={cn(
                'flex items-center gap-1.5 rounded p-2 text-xs font-medium',
                feedback.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
              )}
            >
              {feedback.type === 'success' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
              <span>{feedback.text}</span>
            </div>
          )}
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              onClick={handleSave}
              disabled={isSaving}
              className="h-8 w-full cursor-pointer gap-1.5 text-xs font-semibold text-airbus-navy"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save report configuration
            </Button>
          )}
          <Button
            type="button"
            onClick={handlePrint}
            className="flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded bg-[#DA1884] text-xs font-bold text-white shadow-sm hover:bg-[#b0136a]"
          >
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </Button>
          <p className="text-[10px] leading-snug text-slate-400">
            In the print dialog choose <strong>Landscape</strong>, margins <strong>None</strong> and enable{' '}
            <strong>Background graphics</strong>.
          </p>
        </div>
      </aside>

      {/* ------------------------------ PREVIEW ------------------------------ */}
      <main className="report-preview min-w-0 flex-1 overflow-auto p-8">
        {isLoadingSummary && (
          <div className="mx-auto mb-4 flex w-max items-center gap-2 rounded bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading executive summary…
          </div>
        )}
        <div className="report-print-area mx-auto w-max">
          {showCover && <CoverPage meta={meta} />}
          {sections.filter((s) => s.visible).map((s) => (
            <React.Fragment key={s.key}>{renderSection(s)}</React.Fragment>
          ))}
        </div>
      </main>

      {/* ------------------------------ SETUP ------------------------------ */}
      <Dialog open={showSetup} onOpenChange={setShowSetup}>
        <DialogContent className="rounded-lg border border-slate-200 bg-white p-6 shadow-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="border-b pb-2 text-sm font-bold text-airbus-navy">Report setup</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <Field label="Report title">
              <Input value={printTitle} onChange={(e) => setPrintTitle(e.target.value)} className="h-8 text-xs" />
            </Field>
            <Field label="Subtitle">
              <Input value={printSubtitle} onChange={(e) => setPrintSubtitle(e.target.value)} placeholder="e.g. Q3 2026 Review" className="h-8 text-xs" />
            </Field>
            <Field label="Classification label">
              <Input value={classification} onChange={(e) => setClassification(e.target.value)} className="h-8 text-xs" />
            </Field>
            <Field label="Footer text">
              <Input value={footerText} onChange={(e) => setFooterText(e.target.value)} className="h-8 text-xs" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Report date">
                <Input type="date" value={footerDate} onChange={(e) => setFooterDate(e.target.value)} className="h-8 font-mono text-xs" />
              </Field>
              <Field label="Max rows per table page">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={rowsPerPage}
                  onChange={(e) => setRowsPerPage(Math.min(50, Math.max(1, Number(e.target.value) || 15)))}
                  className="h-8 font-mono text-xs"
                />
              </Field>
            </div>
            <p className="text-[10px] text-slate-400">Tables also paginate automatically when rows are too tall to fit.</p>
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => setShowSetup(false)} className="h-8 px-4 text-xs">
              Close
            </Button>
            {canEdit && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="h-8 cursor-pointer gap-1.5 bg-airbus-navy px-4 text-xs font-semibold text-white hover:bg-airbus-blue"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Cover page                                                          */
/* ------------------------------------------------------------------ */

const CoverPage: React.FC<{ meta: ReportMeta }> = ({ meta }) => (
  <section className="report-page report-cover">
    <div className="flex shrink-0 justify-end pt-[2mm] text-[10px] font-bold uppercase tracking-wider text-[#C8102E]">
      {meta.classification}
    </div>
    <div className="flex-1" />
    <div className="-mx-[10mm] flex items-end justify-between gap-[8mm] bg-gradient-to-r from-[#0055c8] via-[#00409a] to-[#00205B] px-[14mm] py-[10mm] text-white">
      <div className="min-w-0">
        <div className="mb-[2mm] text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70">ERM Cockpit · Risk &amp; Opportunity Report</div>
        <h1 className="text-[28px] font-extrabold leading-tight">{meta.title}</h1>
        {meta.subtitle && <div className="mt-[1.5mm] text-[14px] font-medium text-white/85">{meta.subtitle}</div>}
      </div>
      <div className="shrink-0 text-[22px] font-black tracking-[0.18em]">AIRBUS</div>
    </div>
    <div className="flex h-[22mm] shrink-0 items-end justify-between pb-[2mm] text-[9px] text-slate-500">
      <span>{meta.footerText}</span>
      <span className="font-mono">{meta.footerDate}</span>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* Sidebar helpers                                                     */
/* ------------------------------------------------------------------ */

const SidebarLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{children}</div>
);

const CheckRow: React.FC<{ id: string; checked: boolean; onChange: (v: boolean) => void; label: string }> = ({
  id,
  checked,
  onChange,
  label,
}) => (
  <div className="flex items-center gap-2">
    <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChange(Boolean(c))} />
    <label htmlFor={id} className="cursor-pointer font-medium text-slate-700">
      {label}
    </label>
  </div>
);

const IconBtn: React.FC<{ onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ onClick, disabled, children }) => (
  <Button
    variant="ghost"
    size="icon-xs"
    disabled={disabled}
    onClick={onClick}
    className="h-5 w-5 cursor-pointer p-0 text-slate-500 hover:text-slate-800 disabled:opacity-30"
  >
    {children}
  </Button>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1">
    <label className="font-semibold text-slate-700">{label}</label>
    {children}
  </div>
);

const CountTag: React.FC<{ n: number; noun: string }> = ({ n, noun }) => (
  <span className="text-[9px] text-slate-500">
    {n} {n === 1 ? noun : noun === 'opportunity' ? 'opportunities' : `${noun}s`}
  </span>
);

const OnePagerPicker: React.FC<{
  label: string;
  rows: ArmRiskRow[];
  excluded: Set<number>;
  onToggle: (pk: number) => void;
  onBulk: (rows: ArmRiskRow[], mode: 'all' | 'none' | 'top') => void;
}> = ({ label, rows, excluded, onToggle, onBulk }) => {
  const [open, setOpen] = useState(false);
  const selected = rows.filter((r) => !excluded.has(getRowPk(r))).length;

  return (
    <div className="overflow-hidden rounded border border-slate-200">
      <div
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center justify-between bg-slate-50 p-2 font-semibold text-airbus-navy hover:bg-slate-100"
      >
        <span className="flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {label}
        </span>
        <span className="font-mono text-[11px] font-normal text-slate-500">
          {selected}/{rows.length}
        </span>
      </div>
      {open && (
        <div className="bg-white">
          {rows.length > 0 && (
            <div className="flex gap-1 border-b border-slate-100 px-2 py-1.5">
              {(['all', 'top', 'none'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onBulk(rows, m)}
                  className="cursor-pointer rounded border border-slate-200 px-2 py-0.5 text-[10px] font-semibold capitalize text-slate-600 hover:bg-slate-100"
                >
                  {m === 'top' ? 'Top only' : m}
                </button>
              ))}
            </div>
          )}
          <div className="max-h-56 space-y-0.5 overflow-y-auto p-1.5">
            {rows.length === 0 && <div className="p-2 text-center text-[11px] italic text-slate-400">None registered.</div>}
            {rows.map((r) => {
              const pk = getRowPk(r);
              return (
                <label key={pk} className="flex cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-slate-50">
                  <Checkbox checked={!excluded.has(pk)} onCheckedChange={() => onToggle(pk)} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="font-mono font-bold text-slate-700">{getRowDisplayId(r)}</span>
                    <span className="block truncate text-[10px] text-slate-500">{getRowTitle(r)}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Print stylesheet                                                    */
/* ------------------------------------------------------------------ */

const REPORT_CSS = `
.report-print-area {
  counter-reset: report-page;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
}
.report-page {
  position: relative;
  box-sizing: border-box;
  width: 297mm;
  height: 210mm;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 5mm 10mm 4mm;
  background: #ffffff;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
  font-family: Inter, 'Geist Variable', Helvetica, Arial, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.report-page * {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.report-page:not(.report-page--probe) { counter-increment: report-page; }
.report-page-number::after { content: counter(report-page); }
.report-measure {
  position: absolute;
  left: -100000px;
  top: 0;
  visibility: hidden;
  pointer-events: none;
}
.report-table { table-layout: auto; }
.report-table tr { break-inside: avoid; }

@media print {
  @page { size: A4 landscape; margin: 0; }

  html, body { background: #ffffff !important; }

  /* Flatten every ancestor of the report so nothing clips it (h-screen, overflow-hidden, flex...) */
  *:has(.report-print-area) {
    display: block !important;
    position: static !important;
    width: auto !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
    padding: 0 !important;
    margin: 0 !important;
    border: 0 !important;
    background: #ffffff !important;
    box-shadow: none !important;
    transform: none !important;
  }
  /* Hide everything that is not on the path to the report (app header, sidebar, dialogs, toasts) */
  *:has(.report-print-area) > *:not(:has(.report-print-area)):not(.report-print-area) {
    display: none !important;
  }

  .report-print-area {
    display: block !important;
    width: 297mm !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .report-measure { display: none !important; }
  .report-page {
    margin: 0 !important;
    box-shadow: none !important;
    height: 209.6mm;
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
  }
  .report-page:last-of-type {
    break-after: auto;
    page-break-after: auto;
  }
}
`;

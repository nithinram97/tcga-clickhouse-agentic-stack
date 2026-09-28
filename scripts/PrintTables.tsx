import React, { useMemo } from 'react';
import { CornerDownRight } from 'lucide-react';
import { cn } from '../../../../@/lib/utils';
import type { ActionRow, ArmRiskRow } from '../../../context/DashboardContext';
import type { ColumnDefinition, MitigationColumnDefinition } from '../../../types/dashboardSettings';
import {
  buildHierarchicalTreeRows,
  formatOccurrenceDate,
  getRowTrendLabel,
  getScoreLevelAndColor,
  getTrendConfig,
  type TreeProcessedRow,
} from '../../../utils/reportTableUtils';
import { getRowDisplayId, getRowPk, getRowTitle } from '../../../utils/reportPrintUtils';
import { EmptyNote, FitToBox, PaginatedTable, ReportPage, type ReportMeta } from './ReportPrimitives';

const TH = 'border border-[#00205B] bg-[#00205B] px-[1.4mm] py-[1.2mm] text-left align-bottom text-[9px] font-semibold text-white';
const TD = 'border border-slate-200 px-[1.4mm] py-[1mm] align-top text-slate-800 break-words';

const SCORE_KEYS = new Set(['riskscore', 'riskscore_display', 'riskscore_display_level']);
const PREV_SCORE_KEYS = new Set(['previous_score', 'previous_score_display', 'previous_ARM_impactscore_level']);
const TARGET_SCORE_KEYS = new Set(['ARM_tar_impactscore_display', 'ARM_tar_impactscore', 'ARM_tar_impactscore_level']);
const LONG_TEXT_KEYS = new Set(['riskdescription', 'lastreviewcomments', 'assessment_justification', 'response_title']);

const ScoreBadge: React.FC<{ value: unknown; type: 'Risk' | 'Opportunity' }> = ({ value, type }) => {
  if (value == null || value === '' || isNaN(Number(value))) return <span className="text-slate-400">-</span>;
  const lvl = getScoreLevelAndColor(Number(value), type);
  return (
    <span className={cn('inline-block whitespace-nowrap rounded-[0.6mm] border px-[1.2mm] font-mono text-[9px]', lvl.badgeCss)}>
      {lvl.levelCode}
    </span>
  );
};

const stringify = (v: unknown): string => {
  if (v == null || v === '') return '-';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '-';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/* ------------------------------------------------------------------ */
/* Risks / Opportunities table                                         */
/* ------------------------------------------------------------------ */

interface RiskTableSectionProps {
  meta: ReportMeta;
  type: 'Risk' | 'Opportunity';
  rows: ArmRiskRow[];
  columns: ColumnDefinition[];
  cellValues: Record<string, string>;
  includeChildren: boolean;
  maxRowsPerPage: number;
}

export const RiskTableSection: React.FC<RiskTableSectionProps> = ({
  meta,
  type,
  rows,
  columns,
  cellValues,
  includeChildren,
  maxRowsPerPage,
}) => {
  const treeRows = useMemo(() => buildHierarchicalTreeRows(rows, includeChildren), [rows, includeChildren]);
  const heading = type === 'Risk' ? 'Risks Table' : 'Opportunities Table';

  const renderCell = (col: ColumnDefinition, tr: TreeProcessedRow) => {
    const { row } = tr;
    const pk = getRowPk(row);

    if (col.isAdded) return cellValues[`${pk}##${col.key}`] || '-';
    if (col.key === 'riskid_raw') return <span className="font-mono font-bold text-[#00205B]">{getRowDisplayId(row)}</span>;
    if (col.key === 'risktitle') {
      return (
        <span className="inline-flex items-start gap-[0.8mm] font-semibold" style={{ paddingLeft: `${tr.indentDepth * 3}mm` }}>
          {tr.indentDepth > 0 && <CornerDownRight className="mt-[0.3mm] h-[2.6mm] w-[2.6mm] shrink-0 text-slate-400" />}
          {getRowTitle(row)}
        </span>
      );
    }
    if (col.key === 'riskdescription') return String(row.riskdescription || row.arm_description || '-');
    if (col.key === 'perimeter') return String(row.perimeter || row.riskperimeter || row.arm_perimeter || '-');
    if (SCORE_KEYS.has(col.key)) return <ScoreBadge value={row.riskscore_display ?? row.riskscore ?? row.arm_score} type={type} />;
    if (PREV_SCORE_KEYS.has(col.key))
      return <ScoreBadge value={row.previous_score_display ?? row.previous_score ?? row.previous_ARM_impactscore_display} type={type} />;
    if (TARGET_SCORE_KEYS.has(col.key)) return <ScoreBadge value={row.ARM_tar_impactscore_display ?? row.ARM_tar_impactscore} type={type} />;
    if (col.key === 'Trend' || col.key === 'month_trend') {
      const t = getTrendConfig(row[col.key]);
      return (
        <span className={cn('inline-flex items-center gap-[0.6mm] whitespace-nowrap [&_svg]:h-[2.6mm] [&_svg]:w-[2.6mm]', t.css)}>
          {t.icon}
          {t.label}
        </span>
      );
    }
    if (col.key === 'list_items') return tr.resolvedChildrenIds || '-';
    if (col.key === 'riskParent' || col.key === 'riskparent') return tr.resolvedParentId || '-';
    if (col.key === 'occurrence_date') return formatOccurrenceDate(row.occurrence_date);
    return stringify(row[col.key]);
  };

  const thead = (
    <thead>
      <tr>
        <th className={cn(TH, 'w-[6mm] text-center')}>#</th>
        {columns.map((c) => (
          <th key={c.key} className={cn(TH, LONG_TEXT_KEYS.has(c.key) && 'min-w-[45mm]')}>
            {c.title}
          </th>
        ))}
      </tr>
    </thead>
  );

  return (
    <PaginatedTable
      rows={treeRows}
      maxRowsPerPage={maxRowsPerPage}
      thead={thead}
      renderRow={(tr, i) => (
        <tr key={`${getRowPk(tr.row)}-${i}`} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
          <td className={cn(TD, 'text-center font-mono text-slate-400')}>{i + 1}</td>
          {columns.map((c) => (
            <td key={c.key} className={cn(TD, LONG_TEXT_KEYS.has(c.key) && 'min-w-[45mm]')}>
              {renderCell(c, tr)}
            </td>
          ))}
        </tr>
      )}
      emptyState={<EmptyNote>No {type === 'Risk' ? 'risks' : 'opportunities'} in this dashboard.</EmptyNote>}
      renderPage={({ table, pageIndex, pageCount, probe, bodyRef }) => (
        <ReportPage
          key={pageIndex}
          meta={meta}
          probe={probe}
          bodyRef={bodyRef}
          fit={!probe}
          heading={pageCount > 1 ? `${heading} (${pageIndex + 1}/${pageCount})` : heading}
          headingRight={<span className="text-[9px] text-slate-500">{treeRows.length} item(s)</span>}
        >
          {table}
        </ReportPage>
      )}
    />
  );
};

/* ------------------------------------------------------------------ */
/* Action tracker table (also reused inside OnePagers)                 */
/* ------------------------------------------------------------------ */

export const renderActionCell = (
  col: MitigationColumnDefinition,
  action: ActionRow,
  cellValues: Record<string, string>,
  parentIdDisplay: string,
): React.ReactNode => {
  if (col.isAdded) return cellValues[`${action.primary_key}##${col.key}`] || stringify(action[col.key]);
  if (col.key === 'response_due_date' || col.key === 'response_completion_date') {
    return <span className="whitespace-nowrap font-mono">{formatOccurrenceDate(action[`${col.key}_raw`] || action[col.key])}</span>;
  }
  if (col.key === 'riskid' || col.key === 'risk_id') return <span className="font-mono font-bold text-[#0055c8]">{parentIdDisplay}</span>;
  if (col.key === 'ARM_risktitle') return String(action.ARM_risktitle || action.risk_title || '-');
  if (col.key === 'planned_percentage' || col.key === 'achieved_percentage') {
    const v = action[col.key];
    return v == null ? '-' : `${v}%`;
  }
  return stringify(action[col.key]);
};

export const dueDateCellClass = (action: ActionRow): string => {
  const late = action.css_mitigation === 'late' || action.status_tracker === 'Late';
  const pending = action.css_mitigation === 'pending' || action.status_tracker === 'Pending';
  return late ? 'bg-red-600 text-white font-bold' : pending ? 'bg-amber-500 text-white font-bold' : '';
};

export const ActionTable: React.FC<{
  actions: ActionRow[];
  columns: MitigationColumnDefinition[];
  cellValues: Record<string, string>;
  parentIdFor: (a: ActionRow) => string;
  compact?: boolean;
}> = ({ actions, columns, cellValues, parentIdFor, compact }) => (
  <table className={cn('w-full border-collapse', compact ? 'text-[8.5px]' : 'text-[9.5px]')}>
    <thead>
      <tr>
        {columns.map((c) => (
          <th key={c.key} className={TH}>
            {c.title}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {actions.map((a, i) => (
        <tr key={String(a.primary_key ?? i)} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
          {columns.map((c) => (
            <td key={c.key} className={cn(TD, c.key === 'response_due_date' && dueDateCellClass(a))}>
              {renderActionCell(c, a, cellValues, parentIdFor(a))}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

interface ActionTrackerSectionProps {
  meta: ReportMeta;
  title?: string;
  actions: ActionRow[];
  columns: MitigationColumnDefinition[];
  cellValues: Record<string, string>;
  parentIdFor: (a: ActionRow) => string;
  maxRowsPerPage: number;
}

export const ActionTrackerSection: React.FC<ActionTrackerSectionProps> = ({
  meta,
  title = 'Action Tracker',
  actions,
  columns,
  cellValues,
  parentIdFor,
  maxRowsPerPage,
}) => (
  <PaginatedTable
    rows={actions}
    maxRowsPerPage={maxRowsPerPage}
    thead={
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={cn(TH, LONG_TEXT_KEYS.has(c.key) && 'min-w-[60mm]')}>
              {c.title}
            </th>
          ))}
        </tr>
      </thead>
    }
    renderRow={(a, i) => (
      <tr key={String(a.primary_key ?? i)} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
        {columns.map((c) => (
          <td
            key={c.key}
            className={cn(TD, LONG_TEXT_KEYS.has(c.key) && 'min-w-[60mm]', c.key === 'response_due_date' && dueDateCellClass(a))}
          >
            {renderActionCell(c, a, cellValues, parentIdFor(a))}
          </td>
        ))}
      </tr>
    )}
    emptyState={<EmptyNote>No mitigation actions match the saved Action Tracker filters.</EmptyNote>}
    renderPage={({ table, pageIndex, pageCount, probe, bodyRef }) => (
      <ReportPage
        key={pageIndex}
        meta={meta}
        probe={probe}
        bodyRef={bodyRef}
        fit={!probe}
        heading={pageCount > 1 ? `${title} (${pageIndex + 1}/${pageCount})` : title}
        headingRight={
          <span className="inline-flex items-center gap-[3mm] text-[8.5px] text-slate-600">
            <span className="inline-flex items-center gap-[1mm]">
              <span className="h-[2.5mm] w-[2.5mm] rounded-[0.4mm] bg-red-600" /> Late
            </span>
            <span className="inline-flex items-center gap-[1mm]">
              <span className="h-[2.5mm] w-[2.5mm] rounded-[0.4mm] bg-amber-500" /> Pending
            </span>
            <span>{actions.length} action(s)</span>
          </span>
        }
      >
        {table}
      </ReportPage>
    )}
  />
);

/* ------------------------------------------------------------------ */
/* Risk / Opportunity metrics                                          */
/* ------------------------------------------------------------------ */

const STATUSES = ['Active', 'Draft', 'Occurred', 'Closed', 'Rejected'] as const;
const TRENDS = ['Degraded', 'Improved', 'Stable', 'Not Defined'] as const;
const TREND_COLORS: Record<string, string> = {
  Degraded: 'text-red-600',
  Improved: 'text-emerald-600',
  Stable: 'text-[#0055c8]',
  'Not Defined': 'text-slate-500',
};

const computeMetrics = (rows: ArmRiskRow[]) => {
  const statuses: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const trends: Record<string, number> = Object.fromEntries(TRENDS.map((t) => [t, 0]));
  rows.forEach((r) => {
    const st = String(r.riskstatus || 'Draft').toLowerCase();
    const match = STATUSES.find((s) => st.includes(s.toLowerCase()));
    if (match) statuses[match]++;
    const tr = getRowTrendLabel(r);
    trends[tr in trends ? tr : 'Not Defined']++;
  });
  return { statuses, trends };
};

const MetricBlock: React.FC<{ label: string; rows: ArmRiskRow[] }> = ({ label, rows }) => {
  const m = computeMetrics(rows);
  const total = rows.length || 1;
  return (
    <div className="space-y-[2mm]">
      <div className="flex items-baseline justify-between border-b-2 border-[#0055c8] pb-[0.8mm]">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#00205B]">{label}</span>
        <span className="font-mono text-[10px] text-slate-500">Total {rows.length}</span>
      </div>
      <div className="grid grid-cols-5 gap-[2mm]">
        {STATUSES.map((s) => (
          <MetricCard key={s} label={s} value={m.statuses[s]} pct={m.statuses[s] / total} />
        ))}
      </div>
      <div className="grid grid-cols-4 gap-[2mm]">
        {TRENDS.map((t) => (
          <MetricCard key={t} label={t} value={m.trends[t]} pct={m.trends[t] / total} valueClass={TREND_COLORS[t]} />
        ))}
      </div>
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: number; pct: number; valueClass?: string }> = ({
  label,
  value,
  pct,
  valueClass,
}) => (
  <div className="rounded-[1mm] border border-slate-300 bg-slate-50/60 px-[2.5mm] py-[2mm]">
    <div className="text-[9px] font-semibold text-slate-500">{label}</div>
    <div className={cn('font-mono text-[18px] font-extrabold leading-tight text-slate-900', valueClass)}>{value}</div>
    <div className="mt-[1mm] h-[1mm] overflow-hidden rounded-full bg-slate-200">
      <div className="h-full bg-[#0055c8]" style={{ width: `${Math.round(pct * 100)}%` }} />
    </div>
  </div>
);

export const RiskMetricsSection: React.FC<{ meta: ReportMeta; risks: ArmRiskRow[]; opps: ArmRiskRow[] }> = ({
  meta,
  risks,
  opps,
}) => (
  <ReportPage meta={meta} heading="Risk / Opportunity Trends and Status" fit={false}>
    <FitToBox>
      <div className="space-y-[6mm] pt-[2mm]">
        <MetricBlock label="Risks" rows={risks} />
        <MetricBlock label="Opportunities" rows={opps} />
      </div>
    </FitToBox>
  </ReportPage>
);

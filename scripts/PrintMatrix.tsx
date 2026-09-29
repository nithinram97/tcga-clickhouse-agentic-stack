import React, { useMemo } from 'react';
import { AlertTriangle, Target, Zap } from 'lucide-react';
import { cn } from '../../../../@/lib/utils';
import { useDashboardContext, type ArmRiskRow } from '../../../context/DashboardContext';
import { getNewTopRiskCategory, getTrendConfig, isCriticalityDiffers } from '../../../utils/reportTableUtils';
import {
  getMatrixCellId,
  getQuadrantIndex,
  getRowDisplayId,
  getRowPk,
  getRowTitle,
  isTopRiskRow,
} from '../../../utils/reportPrintUtils';
import { getRowLevel1, getSiglumColorMap, useSiglumColor } from '../../../utils/siglumColors';
import { RICH_HTML_CLASSES } from './reportStyles';

export type MatrixType = 'Risk' | 'Opportunity';

/* Same grids / colours as useDashboardMapsTab */
const RISK_GRID: { id: number; bg: string }[][] = [
  [{ id: 12, bg: '#E6E066' }, { id: 7, bg: '#E6E066' }, { id: 3, bg: '#FFA048' }, { id: 1, bg: '#F26B7A' }],
  [{ id: 13, bg: '#A6DB6D' }, { id: 9, bg: '#E6E066' }, { id: 5, bg: '#FFA048' }, { id: 2, bg: '#F26B7A' }],
  [{ id: 15, bg: '#A6DB6D' }, { id: 11, bg: '#E6E066' }, { id: 6, bg: '#FFA048' }, { id: 4, bg: '#FFA048' }],
  [{ id: 16, bg: '#A6DB6D' }, { id: 14, bg: '#A6DB6D' }, { id: 10, bg: '#E6E066' }, { id: 8, bg: '#E6E066' }],
];

const OPP_GRID: { id: number; bg: string; dark?: boolean }[][] = [
  [{ id: 1, bg: '#1d5375', dark: true }, { id: 3, bg: '#2b80b9', dark: true }, { id: 7, bg: '#5ca8db' }, { id: 12, bg: '#5ca8db' }],
  [{ id: 2, bg: '#1d5375', dark: true }, { id: 5, bg: '#2b80b9', dark: true }, { id: 9, bg: '#5ca8db' }, { id: 13, bg: '#a2d2f2' }],
  [{ id: 4, bg: '#2b80b9', dark: true }, { id: 6, bg: '#2b80b9', dark: true }, { id: 11, bg: '#5ca8db' }, { id: 15, bg: '#a2d2f2' }],
  [{ id: 8, bg: '#5ca8db' }, { id: 10, bg: '#5ca8db' }, { id: 14, bg: '#a2d2f2' }, { id: 16, bg: '#a2d2f2' }],
];

export const MATRIX_COLORS = { RISK_GRID, OPP_GRID };

const PROBABILITY_LABELS = ['Nearly Certain', 'Likely', 'Possible', 'Unlikely'];
const IMPACT_RISK = ['Low', 'Medium', 'High', 'Very High'];
const IMPACT_OPP = ['Very High', 'High', 'Medium', 'Low'];

/* ------------------------------------------------------------------ */
/* Static risk pill (no popover / buttons)                             */
/* ------------------------------------------------------------------ */

export const PrintRiskPill: React.FC<{ risk: ArmRiskRow; displayMode: 'Id' | 'Title'; size?: 'sm' | 'md' }> = ({
  risk,
  displayMode,
  size = 'sm',
}) => {
  const topCat = getNewTopRiskCategory(risk);
  const isTop = isTopRiskRow(risk);
  const occurred = String(risk.riskstatus || '').toLowerCase().includes('occurred');
  const levelColor = useSiglumColor(risk);
  const trend = getTrendConfig(risk.Trend);

  return (
    <span
      className={cn(
        'relative inline-flex max-w-full items-center gap-[0.6mm] overflow-hidden rounded-full border bg-white font-mono leading-tight text-slate-900',
        size === 'sm' ? 'px-[1.4mm] py-[0.2mm] text-[7.5px]' : 'px-[2mm] py-[0.4mm] text-[9.5px]',
        isTop ? 'border-[#00205B] font-bold' : 'border-slate-300 font-medium',
        levelColor && 'pl-[2.2mm]',
      )}
    >
      {levelColor && (
        <span className="absolute inset-y-0 left-0 w-[1.2mm]" style={{ backgroundColor: levelColor }} />
      )}
      {isCriticalityDiffers(risk) && <AlertTriangle className="h-[2.4mm] w-[2.4mm] shrink-0 fill-amber-300 text-amber-700" />}
      {occurred && <Zap className="h-[2.4mm] w-[2.4mm] shrink-0 fill-orange-400 text-orange-600" />}
      {topCat === 'New' && (
        <span className="shrink-0 rounded-[0.5mm] border border-[#C8102E] px-[0.4mm] text-[6px] font-bold uppercase leading-none text-[#C8102E]">
          new
        </span>
      )}
      <span className={cn('whitespace-normal break-words', topCat === 'Removed' && 'line-through')}>
        {displayMode === 'Id' ? getRowDisplayId(risk) : getRowTitle(risk)}
      </span>
      <span className="shrink-0 [&_svg]:h-[2.4mm] [&_svg]:w-[2.4mm]">{trend.icon}</span>
    </span>
  );
};

export const MatrixLegend: React.FC<{ type: MatrixType; siglums?: { siglum: string; color: string }[] }> = ({ type, siglums = [] }) => {
  const noun = type === 'Risk' ? 'Risk' : 'Opportunity';
  return (
    <div className="flex flex-wrap items-center gap-x-[5mm] gap-y-[1mm] text-[8.5px] text-slate-700">
      <span className="inline-flex items-center gap-[1mm]">
        <AlertTriangle className="h-[2.8mm] w-[2.8mm] fill-amber-300 text-amber-700" /> Criticality differs from ARM
      </span>
      <span className="inline-flex items-center gap-[1mm]">
        <Zap className="h-[2.8mm] w-[2.8mm] fill-orange-400 text-orange-600" /> Occurrence
      </span>
      <span className="inline-flex items-center gap-[1mm]">
        <span className="rounded-[0.5mm] border border-[#C8102E] px-[0.4mm] text-[6px] font-bold uppercase leading-none text-[#C8102E]">
          new
        </span>
        New Top {noun}
      </span>
      <span className="line-through">Removed Top {noun}</span>
      <span className="inline-flex items-center gap-[1mm]">
        <span className="rounded-full border border-[#00205B] px-[1.2mm] font-mono text-[7px] font-bold">ID</span> Top {noun}
      </span>
      {siglums.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-x-[2mm] gap-y-[0.5mm] border-l border-slate-300 pl-[3mm]">
          <span className="font-semibold text-slate-500">Siglum:</span>
          {siglums.map((s) => (
            <span key={s.siglum} className="inline-flex items-center gap-[0.8mm]">
              <span className="h-[2.2mm] w-[2.2mm] rounded-full" style={{ backgroundColor: s.color }} />
              {s.siglum}
            </span>
          ))}
        </span>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Full-page heatmap / coldmap                                         */
/* ------------------------------------------------------------------ */

interface PrintMatrixProps {
  type: MatrixType;
  rows: ArmRiskRow[];
  displayMode: 'Id' | 'Title';
  commentsHtml?: string;
  assumptionHtml?: string;
  assumptionDate?: string;
}

export const PrintMatrix: React.FC<PrintMatrixProps> = ({
  type,
  rows,
  displayMode,
  commentsHtml,
  assumptionHtml,
  assumptionDate,
}) => {
  const isOpp = type === 'Opportunity';
  const grid = isOpp ? OPP_GRID : RISK_GRID;
  const impactLabels = isOpp ? IMPACT_OPP : IMPACT_RISK;

  const { cellMap, unscored } = useMemo(() => {
    const map = new Map<number, ArmRiskRow[]>();
    const zero: ArmRiskRow[] = [];
    rows.forEach((r) => {
      const id = getMatrixCellId(r);
      if (id === 0) zero.push(r);
      else map.set(id, [...(map.get(id) || []), r]);
    });
    return { cellMap: map, unscored: zero };
  }, [rows]);

  const hasComments = Boolean(commentsHtml?.trim() || assumptionHtml?.trim());

  // Same siglum colours as the Heatmap tab (dashboard-wide map)
  const { allRiskRows } = useDashboardContext();
  const siglumKey = useMemo(() => {
    const colors = getSiglumColorMap(allRiskRows);
    const present = new Set(rows.map(getRowLevel1).filter(Boolean));
    return Array.from(present)
      .sort((a, b) => a.localeCompare(b))
      .map((siglum) => ({ siglum, color: colors.get(siglum) ?? '#9AA5BB' }));
  }, [allRiskRows, rows]);

  const yLabels = (
    <div className="grid w-[5mm] shrink-0" style={{ gridTemplateRows: 'repeat(4, minmax(0, 1fr))' }}>
      {PROBABILITY_LABELS.map((l) => (
        <div key={l} className="flex items-center justify-center">
          <span
            className={cn('whitespace-nowrap text-[8px] font-medium text-slate-500', isOpp ? 'rotate-90' : '-rotate-90')}
          >
            {l}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-[2mm]">
      <MatrixLegend type={type} siglums={siglumKey} />

      <div className="flex w-full gap-[1mm]">
        {!isOpp && yLabels}
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className={cn('grid gap-[1.2mm] border-slate-400', isOpp ? 'border-b border-r' : 'border-b border-l')}
            style={{
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gridAutoRows: hasComments ? 'minmax(24mm, auto)' : 'minmax(30mm, auto)',
            }}
          >
            {grid.flat().map((cell) => {
              const items = cellMap.get(cell.id) || [];
              const quads = { 1: [], 2: [], 3: [], 4: [] } as Record<1 | 2 | 3 | 4, ArmRiskRow[]>;
              items.forEach((it) => quads[getQuadrantIndex(it.riskscore ?? it.arm_score)].push(it));
              const dark = 'dark' in cell && cell.dark;

              return (
                <div
                  key={cell.id}
                  className="flex min-w-0 flex-col rounded-[0.8mm] p-[1mm]"
                  style={{ backgroundColor: cell.bg }}
                >
                  <div className="mb-[0.6mm] flex items-center gap-[1mm]">
                    <span className="flex h-[3.6mm] w-[3.6mm] items-center justify-center rounded-full border border-slate-400/60 bg-white/85 font-mono text-[7px] font-bold text-slate-800">
                      {cell.id}
                    </span>
                    {items.length > 0 && (
                      <span className={cn('font-mono text-[8px] font-semibold', dark ? 'text-white/90' : 'text-slate-800/80')}>
                        {items.length}
                      </span>
                    )}
                  </div>
                  {items.length > 0 && (
                    <div className="grid flex-1 grid-cols-2 gap-[0.6mm]">
                      {([3, 1, 4, 2] as const).map((q) => (
                        <div key={q} className="flex min-w-0 flex-wrap content-start items-start gap-[0.6mm] rounded-[0.5mm] bg-white/15 p-[0.4mm]">
                          {quads[q].map((it) => (
                            <PrintRiskPill key={getRowPk(it) || getRowDisplayId(it)} risk={it} displayMode={displayMode} />
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="grid pt-[1mm] text-center text-[8.5px] font-medium text-slate-500" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            {impactLabels.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>
        </div>
        {isOpp && yLabels}
      </div>

      {unscored.length > 0 && (
        <div className="rounded-[0.8mm] border border-amber-300 bg-amber-50 px-[2mm] py-[1mm] text-[8.5px] text-amber-900">
          <span className="font-semibold">
            {unscored.length} {isOpp ? 'opportunit' + (unscored.length > 1 ? 'ies' : 'y') : 'risk' + (unscored.length > 1 ? 's' : '')} without score:
          </span>{' '}
          <span className="inline-flex flex-wrap gap-[0.8mm] align-middle">
            {unscored.map((r) => (
              <PrintRiskPill key={getRowPk(r) || getRowDisplayId(r)} risk={r} displayMode={displayMode} />
            ))}
          </span>
        </div>
      )}

      {hasComments && (
        <div className="grid grid-cols-2 gap-[3mm]">
          <CommentBox title={isOpp ? 'Coldmap Comments' : 'Heatmap Comments'} html={commentsHtml} />
          <CommentBox title={`Assumption Pack${assumptionDate ? ` (${assumptionDate})` : ''}`} html={assumptionHtml} />
        </div>
      )}
    </div>
  );
};

const CommentBox: React.FC<{ title: string; html?: string }> = ({ title, html }) => (
  <div className="min-h-[22mm] rounded-[1mm] border border-[#00205B]/70 p-[2mm]">
    <div className="mb-[1mm] text-[9px] font-bold text-[#00205B]">{title}</div>
    {html?.trim() ? (
      <div className={RICH_HTML_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
    ) : (
      <div className="text-[9px] italic text-slate-400">No comments recorded.</div>
    )}
  </div>
);

/* ------------------------------------------------------------------ */
/* Compact single-risk matrix for OnePagers                            */
/* ------------------------------------------------------------------ */

export const PrintMiniMatrix: React.FC<{ risk: ArmRiskRow; isOpp: boolean }> = ({ risk, isOpp }) => {
  const grid = isOpp ? OPP_GRID : RISK_GRID;
  const currentId = getMatrixCellId(risk);
  const targetRaw = Math.abs(Number(risk.ARM_tar_impactscore_display ?? risk.ARM_tar_impactscore ?? NaN));
  const targetId = isNaN(targetRaw) || targetRaw === 0 ? 0 : Math.min(Math.max(Math.round(targetRaw), 1), 16);

  return (
    <div
      className="grid h-full w-full gap-[0.8mm]"
      style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gridTemplateRows: 'repeat(4, minmax(0, 1fr))' }}
    >
      {grid.flat().map((cell) => (
        <div
          key={cell.id}
          className="flex min-h-0 min-w-0 flex-col items-center justify-between overflow-hidden rounded-[0.6mm] p-[0.6mm]"
          style={{ backgroundColor: cell.bg }}
        >
          <span className="flex h-[3mm] w-[3mm] shrink-0 items-center justify-center self-start rounded-full bg-white/85 font-mono text-[6px] font-bold text-slate-800">
            {cell.id}
          </span>
          {cell.id === currentId && <PrintRiskPill risk={risk} displayMode="Id" />}
          {cell.id === targetId && (
            <span className="inline-flex max-w-full items-center gap-[0.5mm] rounded-[0.5mm] border border-[#C2185B]/50 bg-[#F8F5C1]/95 px-[0.8mm] font-mono text-[7px] font-bold text-[#C2185B]">
              <Target className="h-[2.2mm] w-[2.2mm] shrink-0" />
              <span className="truncate">{String(risk.target_criticality_date || 'Target')}</span>
            </span>
          )}
          {cell.id !== currentId && cell.id !== targetId && <span />}
        </div>
      ))}
    </div>
  );
};

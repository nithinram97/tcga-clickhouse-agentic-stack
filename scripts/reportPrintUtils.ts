import { format, subYears, addMonths } from 'date-fns';
import type { ActionRow, ArmRiskRow } from '../context/DashboardContext';
import {
  DEFAULT_NEUTRAL_SETTINGS,
  STANDARD_COLUMN_MAPPINGS,
  STANDARD_MITIGATION_COLUMN_MAPPINGS,
  type ColumnDefinition,
  type DashboardSettings,
  type MitigationColumnDefinition,
} from '../types/dashboardSettings';

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

export type Obj = Record<string, unknown>;

export const asObj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};

/** First non-empty object among the candidates. */
const firstObj = (...vals: unknown[]): Obj => {
  for (const v of vals) {
    const o = asObj(v);
    if (Object.keys(o).length > 0) return o;
  }
  return {};
};

export function parseJsonObject<T = Obj>(raw: unknown): T {
  if (!raw) return {} as T;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object' ? parsed : {}) as T;
    } catch {
      return {} as T;
    }
  }
  if (typeof raw === 'object') return raw as T;
  return {} as T;
}

export const parseDashboardSettings = (raw: unknown): DashboardSettings => ({
  ...DEFAULT_NEUTRAL_SETTINGS,
  ...parseJsonObject<DashboardSettings>(raw),
});

export function chunk<T>(list: T[], size: number): T[][] {
  const safe = Math.max(1, size);
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += safe) out.push(list.slice(i, i + safe));
  return out.length > 0 ? out : [[]];
}

/* ------------------------------------------------------------------ */
/* Risk row helpers                                                    */
/* ------------------------------------------------------------------ */

export const isOpportunityRow = (row: ArmRiskRow): boolean =>
  String(row.risktype || row.riskType || row.type || '')
    .toLowerCase()
    .includes('opp');

export const getRowPk = (row: ArmRiskRow): number =>
  Number(row.pk_impact_id || row.PKImpactID || row.primary_key) || 0;

export const getRowDisplayId = (row: ArmRiskRow): string =>
  String(row.riskid_raw || row.pk_impact_id || row.PKImpactID || row.primary_key || '');

/** Same rule as RiskFilter / Table tab: risktoprisk flag (any truthy form) or a 'toprisk' css class. */
export const isTopRiskRow = (row: ArmRiskRow): boolean => {
  const flag = row.risktoprisk as unknown;
  const flagSet =
    flag === true || (flag != null && flag !== '' && !['0', 'false', 'no'].includes(String(flag).trim().toLowerCase()) && Boolean(flag));
  return flagSet || row.is_top_risk === true || Boolean(row.css_toprisk?.includes('toprisk'));
};

export const getRowTitle = (row: ArmRiskRow): string => String(row.risktitle || row.arm_title || '');

/** Same bucketing as the Maps tab (useDashboardMapsTab): |score| rounded, 0 = unscored. */
export const getMatrixCellId = (row: ArmRiskRow): number => {
  const raw = Math.abs(Number(row.riskscore ?? row.arm_score ?? 0));
  if (isNaN(raw)) return 0;
  return Math.min(Math.round(raw), 16);
};

/** Quadrant encoded in the hundredths of the score (.01 → Q1 ... .04 → Q4). */
export const getQuadrantIndex = (score: unknown): 1 | 2 | 3 | 4 => {
  const num = Number(score);
  if (score == null || isNaN(num)) return 1;
  const hundredths = Math.round((Math.abs(num) % 1) * 100);
  if (hundredths >= 1 && hundredths <= 4) return hundredths as 1 | 2 | 3 | 4;
  if (hundredths > 0) {
    const mod = hundredths % 4;
    return (mod === 0 ? 4 : mod) as 1 | 2 | 3 | 4;
  }
  return 1;
};

/* ------------------------------------------------------------------ */
/* Table column resolution (mirrors Table / Action Tracker tabs)       */
/* ------------------------------------------------------------------ */

const RISK_COL_ALIASES: Record<string, string> = {
  risk_id: 'riskid_raw',
  riskid: 'riskid_raw',
  risk_title: 'risktitle',
  arm_title: 'risktitle',
  risk_description: 'riskdescription',
  arm_description: 'riskdescription',
};

export function resolveRiskTableColumns(settings: DashboardSettings): ColumnDefinition[] {
  const added = settings.cols_list?.added_columns || {};
  const all: ColumnDefinition[] = [
    ...STANDARD_COLUMN_MAPPINGS,
    ...Object.entries(added).map(([key, title]) => ({ key, title, isAdded: true })),
  ];
  const savedCols = settings.cols_order_obj?.cols || {};
  let keys = Object.keys(savedCols);
  if (keys.length === 0) {
    keys = settings.cols_list?.raw_columns?.length
      ? settings.cols_list.raw_columns
      : DEFAULT_NEUTRAL_SETTINGS.cols_list?.raw_columns || [];
  }

  const out: ColumnDefinition[] = [];
  const seen = new Set<string>();
  keys.forEach((key) => {
    let col = all.find((c) => c.key === key) || all.find((c) => c.key === RISK_COL_ALIASES[key]);
    if (!col && savedCols[key]?.title) {
      col = { key, title: savedCols[key].title, isAdded: savedCols[key].css === 'added' || Boolean(added[key]) };
    }
    if (col && !seen.has(col.key)) {
      seen.add(col.key);
      out.push(col);
    }
  });
  return out;
}

const MITIGATION_COL_ALIASES: Record<string, string> = {
  risk_id: 'riskid',
  riskid_raw: 'riskid',
  risk_title: 'ARM_risktitle',
  arm_risktitle: 'ARM_risktitle',
};

export function resolveMitigationColumns(settings: DashboardSettings): MitigationColumnDefinition[] {
  const added = settings.cols_mitigations_list?.added_columns || {};
  const all: MitigationColumnDefinition[] = [
    ...STANDARD_MITIGATION_COLUMN_MAPPINGS,
    ...Object.entries(added).map(([key, title]) => ({ key, title, isAdded: true })),
  ];
  const savedCols = settings.cols_mitigations_order_obj?.cols_mitigations || {};
  let keys = Object.keys(savedCols);
  if (keys.length === 0) keys = settings.cols_mitigations_list?.raw_columns || [];
  if (keys.length === 0) keys = ['response_due_date', 'response_title', 'riskid'];

  const out: MitigationColumnDefinition[] = [];
  const seen = new Set<string>();
  keys.forEach((key) => {
    let col = all.find((c) => c.key === key) || all.find((c) => c.key === MITIGATION_COL_ALIASES[key]);
    if (!col && savedCols[key]?.title) {
      col = { key, title: savedCols[key].title, isAdded: savedCols[key].css === 'added' || Boolean(added[key]) };
    }
    if (col && !seen.has(col.key)) {
      seen.add(col.key);
      out.push(col);
    }
  });
  return out;
}

/** Reads { "<pk>##<col>": { value } } maps saved by the Table / Action Tracker tabs. */
export function readCellValues(valueMap: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(asObj(valueMap)).forEach(([key, valObj]) => {
    const v = asObj(valObj).value;
    if (v != null && String(v).trim()) out[key] = String(v);
  });
  return out;
}

export function filterPrintableActions(actions: ActionRow[], settings: DashboardSettings): ActionRow[] {
  const resp = settings.filters_mitigations?.response_status?.values || ['Active', 'Draft'];
  const comp = settings.filters_mitigations?.status_tracker?.values || ['Completed', 'Late', 'Pending', 'On Time'];

  const dueMs = (a: ActionRow) => {
    const t = new Date(String(a.response_due_date_raw || a.response_due_date || '')).getTime();
    return isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };

  return actions
    .filter((a) => {
      if (resp.length > 0 && !resp.includes(a.response_status || 'Draft')) return false;
      if (comp.length > 0 && !comp.includes(a.status_tracker || 'Pending')) return false;
      return true;
    })
    .sort((a, b) => dueMs(a) - dueMs(b));
}

export const getActionParentPk = (a: ActionRow): number => Number(a.riskid || a.pk_impact_id_as_string) || 0;

/* ------------------------------------------------------------------ */
/* OnePager print configuration (mirrors OnePager.tsx parsing)        */
/* ------------------------------------------------------------------ */

export type OnePagerComponentId = 'armInfo' | 'heatmap' | 'waterfall' | 'actionTracker' | 'keyMessages';
export type OnePagerSlotKey = 'slotTopLeft' | 'slotBottomLeft' | 'slotTopCenter' | 'slotBottomCenter' | 'slotRight';

const COMPONENT_IDS: OnePagerComponentId[] = ['armInfo', 'heatmap', 'waterfall', 'actionTracker', 'keyMessages'];

export const ONEPAGER_PRESET_SLOTS: Record<number, Record<OnePagerSlotKey, OnePagerComponentId>> = {
  1: {
    slotTopLeft: 'heatmap',
    slotBottomLeft: 'armInfo',
    slotTopCenter: 'waterfall',
    slotBottomCenter: 'actionTracker',
    slotRight: 'keyMessages',
  },
  2: {
    slotTopLeft: 'armInfo',
    slotBottomLeft: 'armInfo',
    slotTopCenter: 'heatmap',
    slotBottomCenter: 'actionTracker',
    slotRight: 'keyMessages',
  },
};

export interface OnePagerPrintConfig {
  layout: number;
  slots: Record<OnePagerSlotKey, OnePagerComponentId>;
  customComponents: OnePagerComponentId[];
  showAssessment: boolean;
  assessmentPages: { page1: boolean; page2: boolean };
  showReviewComment: boolean;
  reviewCommentPages: { page1: boolean; page2: boolean };
  waterfallMethod: 'percentages' | 'target';
  waterfallRange: [string, string];
  /** Saved resizable-panel percentages, keyed like OnePager.tsx (layout1, layout2, layout3_page1 ...). */
  panelSizes: Record<string, Record<string, number[]>>;
}

const defaultWaterfallRange = (): [string, string] => {
  const today = new Date();
  return [format(subYears(today, 1), 'yyyy-MM-dd'), format(addMonths(today, 1), 'yyyy-MM-dd')];
};

export function parseOnePagerPrintConfig(risk: ArmRiskRow, dashboardSettingsRaw: unknown): OnePagerPrintConfig {
  const parsed = parseJsonObject<Obj>(risk.print_settings || risk.settings || dashboardSettingsRaw);
  const psOuter = asObj(parsed.print_settings);
  const ps = firstObj(psOuter.print_settings, psOuter, parsed);
  const op = firstObj(parsed.onepager, ps.onepager);
  const wf = firstObj(parsed.waterfall, ps.waterfall);

  const rawLayout =
    op.layout || parsed.selectedLayout || parsed.layoutNumber || ps.selectedLayout || ps.layoutNumber || 1;
  const layout = Math.min(Math.max(Number(rawLayout) || 1, 1), 4);

  const rawSlots = firstObj(asObj(risk).onepager_slots, parsed.onepager_slots, ps.onepager_slots);
  const preset = ONEPAGER_PRESET_SLOTS[layout] || ONEPAGER_PRESET_SLOTS[1];
  const slots = { ...preset } as Record<OnePagerSlotKey, OnePagerComponentId>;
  if (layout <= 2) {
    (Object.keys(preset) as OnePagerSlotKey[]).forEach((k) => {
      const v = rawSlots[k] as OnePagerComponentId;
      if (COMPONENT_IDS.includes(v)) slots[k] = v;
    });
  }

  const rawCustom = parsed.custom_components ?? ps.custom_components;
  const customComponents = (Array.isArray(rawCustom) ? rawCustom : ['heatmap', 'waterfall', 'keyMessages']).filter(
    (c): c is OnePagerComponentId => COMPONENT_IDS.includes(c as OnePagerComponentId),
  );

  const pageAss = String(op.page_assessment || ps.page_assessment || parsed.page_assessment || 'assessment_page1');
  const pageLrc = String(
    op['page_last-review-comment'] ||
      ps['page_last-review-comment'] ||
      parsed['page_last-review-comment'] ||
      'last-review-comment_page2',
  );

  const showAssessment = Boolean(
    op.display_assessment ??
      parsed.showAssessmentJustification ??
      ps.showAssessmentJustification ??
      ps.display_assessment ??
      true,
  );
  const showReviewComment = Boolean(
    op.display_lrc ?? parsed.showLastReviewComment ?? ps.showLastReviewComment ?? ps.display_lrc ?? true,
  );

  const [defStart, defEnd] = defaultWaterfallRange();
  const range = Array.isArray(wf.date_range) ? wf.date_range : [];

  return {
    layout,
    slots,
    customComponents,
    showAssessment,
    assessmentPages: { page1: pageAss.includes('page1'), page2: pageAss.includes('page2') },
    showReviewComment,
    reviewCommentPages: { page1: pageLrc.includes('page1'), page2: pageLrc.includes('page2') },
    waterfallMethod: wf.method === 'target' || wf.method === 'numerical' ? 'target' : 'percentages',
    waterfallRange: [String(range[0] || defStart), String(range[1] || defEnd)],
    panelSizes: parsePanelSizes(parsed.panel_sizes ?? ps.panel_sizes),
  };
}

function parsePanelSizes(raw: unknown): Record<string, Record<string, number[]>> {
  const out: Record<string, Record<string, number[]>> = {};
  Object.entries(asObj(raw)).forEach(([layoutKey, groups]) => {
    const g: Record<string, number[]> = {};
    Object.entries(asObj(groups)).forEach(([groupKey, sizes]) => {
      if (Array.isArray(sizes) && sizes.every((n) => typeof n === 'number' && n > 0)) g[groupKey] = sizes as number[];
    });
    out[layoutKey] = g;
  });
  return out;
}

/** Panel sizes with fallback to the OnePager defaults. */
export function getPanelSizes(
  config: OnePagerPrintConfig,
  layoutKey: string,
  groupKey: string,
  fallback: number[],
): number[] {
  const sizes = config.panelSizes[layoutKey]?.[groupKey];
  return sizes && sizes.length === fallback.length ? sizes : fallback;
}

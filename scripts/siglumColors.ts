import type { ArmRiskRow } from '../context/DashboardContext';
import { useDashboardContext } from '../context/DashboardContext';

/**
 * Level 1 siglum colouring, shared by the Heatmap legend, the risk pills and the printed report.
 *
 * Like the legacy Slate legend (legend_external.extract), every Level 1 siglum gets a stable colour
 * from a fixed palette by its index. A colour sent by the backend (color_level1 / border_level1)
 * always wins, so nothing changes when the payload already carries colours.
 */

/* Chosen to stay distinguishable on both the red/orange/yellow/green heatmap and the blue coldmap. */
export const SIGLUM_PALETTE = [
  '#ba04f2', // purple (legacy Slate first colour)
  '#DA1884', // magenta
  '#00838F', // teal
  '#6D4C41', // brown
  '#212121', // near black
  '#F4511E', // deep orange
  '#3949AB', // indigo
  '#7CB342', // light green
  '#8E24AA', // violet
  '#00ACC1', // cyan
  '#C2185B', // raspberry
  '#9E9D24', // olive
  '#5D4037', // dark brown
  '#546E7A', // blue grey
];

export const NO_SIGLUM_COLOR = '#9AA5BB';

const isUsableColor = (c: unknown): c is string =>
  typeof c === 'string' && c.trim() !== '' && c !== 'transparent' && c !== 'none';

/** Level 1 siglum of a row (same source as the existing filter: level1, else siglum owner). */
export const getRowLevel1 = (row: ArmRiskRow): string => String(row.level1 || row.siglum_owner || '').trim();

const cache = new WeakMap<ArmRiskRow[], Map<string, string>>();

/** siglum -> colour for a whole dataset. Cached per rows array, so calling it per pill is cheap. */
export function getSiglumColorMap(rows: ArmRiskRow[]): Map<string, string> {
  const hit = cache.get(rows);
  if (hit) return hit;

  const backend = new Map<string, string>();
  const siglums = new Set<string>();
  rows.forEach((r) => {
    const s = getRowLevel1(r);
    if (!s) return;
    siglums.add(s);
    const c = isUsableColor(r.color_level1) ? r.color_level1 : isUsableColor(r.border_level1) ? r.border_level1 : null;
    if (c && !backend.has(s)) backend.set(s, c);
  });

  const map = new Map<string, string>();
  Array.from(siglums)
    .sort((a, b) => a.localeCompare(b))
    .forEach((s, i) => map.set(s, backend.get(s) ?? SIGLUM_PALETTE[i % SIGLUM_PALETTE.length]));

  cache.set(rows, map);
  return map;
}

export function resolveSiglumColor(row: ArmRiskRow, allRows?: ArmRiskRow[]): string | null {
  if (isUsableColor(row.color_level1)) return row.color_level1;
  const siglum = getRowLevel1(row);
  if (!siglum) return null;
  if (allRows) return getSiglumColorMap(allRows).get(siglum) ?? null;
  return isUsableColor(row.border_level1) ? row.border_level1 : null;
}

/** Hook for pills: colour from the dashboard-wide siglum map. Works (backend colour only) outside a DashboardProvider. */
export function useSiglumColor(row: ArmRiskRow): string | null {
  let allRows: ArmRiskRow[] | undefined;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- useContext is always called; only the "missing provider" throw is caught
    allRows = useDashboardContext().allRiskRows;
  } catch {
    allRows = undefined;
  }
  return resolveSiglumColor(row, allRows);
}

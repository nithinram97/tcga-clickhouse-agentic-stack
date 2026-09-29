
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useDashboardContext, type ArmRiskRow } from '../context/DashboardContext';
import { logger } from '../utils/logger';
import { isNewTopRiskMatch, isCriticalityDiffers, getRowTrendLabel } from '../utils/reportTableUtils';
import { getRowLevel1, getSiglumColorMap, NO_SIGLUM_COLOR } from '../utils/siglumColors';

export interface Level1LegendItem {
  siglum: string;
  color: string;
  count: number;
}

export interface MatrixCellConfig {
  id: number;
  bg: string;
  gridRow: number;
  gridCol: number;
}

export function useDashboardMapsTab(dashboardId: string) {
  const {
    allRiskRows,
    armRoPayload,
    isLoadingPayload,
    payloadError,
    filterState,
    setFilterState,
    searchText,
    setSearchText,
    selectedType,
    setSelectedType,
  } = useDashboardContext();

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedDisplay, setSelectedDisplay] = useState<'Id' | 'Title'>('Id');
  const [matchMode, setMatchMode] = useState<'Any' | 'All'>('Any');
  const [timelineRange, setTimelineRange] = useState<number[]>([2025, 2030]);

  // Active Level 1 Siglum Color Filters
  const [selectedSiglumColors, setSelectedSiglumColorFilters] = useState<string[]>([]);

  // Hierarchical Deep-Dive Navigation Stack
  const [diveStack, setDiveStack] = useState<ArmRiskRow[]>([]);
  const currentDiveParent = diveStack.length > 0 ? diveStack[diveStack.length - 1] : null;

  // Inline Right-Side Panel Edit State
  const [editingRisk, setEditingRisk] = useState<ArmRiskRow | null>(null);

  useEffect(() => {
    logger.info('useDashboardMapsTab', `Loaded Maps Tab for Dashboard: ${dashboardId}`, {
      totalRows: allRiskRows.length,
    });
  }, [dashboardId, allRiskRows.length]);

  // Filter Risks vs Opportunities
  const risksList = useMemo(() => {
    return allRiskRows.filter((r) =>
      String(r.risktype || 'Risk')
        .toLowerCase()
        .includes('risk'),
    );
  }, [allRiskRows]);

  const oppsList = useMemo(() => {
    return allRiskRows.filter((r) =>
      String(r.risktype || '')
        .toLowerCase()
        .includes('opp'),
    );
  }, [allRiskRows]);

  const activeRowsByType = useMemo(() => {
    return selectedType === 'Risk' ? risksList : oppsList;
  }, [selectedType, risksList, oppsList]);

  // Extract Level 1 Function Legend Items (A, K, O, P, Z...)
  // Colours come from the dashboard-wide siglum map so legend, pills and report always agree.
  const level1LegendItems = useMemo<Level1LegendItem[]>(() => {
    const colorMap = getSiglumColorMap(allRiskRows);
    const map = new Map<string, { color: string; count: number }>();

    activeRowsByType.forEach((r) => {
      const siglum = getRowLevel1(r);
      if (!siglum) return;
      if (!map.has(siglum)) {
        map.set(siglum, { color: colorMap.get(siglum) ?? NO_SIGLUM_COLOR, count: 0 });
      }
      map.get(siglum)!.count += 1;
    });

    return Array.from(map.entries())
      .map(([siglum, { color, count }]) => ({
        siglum,
        color,
        count,
      }))
      .sort((a, b) => a.siglum.localeCompare(b.siglum));
  }, [activeRowsByType, allRiskRows]);

  // Keep the siglum selection valid: drop siglums that no longer exist (type switch, payload refresh)
  // and treat "every siglum selected" as "no filter" (same as the legacy Slate legend).
  useEffect(() => {
    setSelectedSiglumColorFilters((prev) => {
      if (prev.length === 0) return prev;
      const available = new Set(level1LegendItems.map((i) => i.siglum));
      const next = prev.filter((s) => available.has(s));
      if (next.length === available.size) return [];
      return next.length === prev.length ? prev : next;
    });
  }, [level1LegendItems]);

  // Scoped rows by active deep-dive parent
  const scopedRowsByDive = useMemo(() => {
    if (!currentDiveParent) return activeRowsByType;

    const childIds = new Set((currentDiveParent.list_items || []).map(Number));
    return activeRowsByType.filter((r) => {
      const pk = r.pk_impact_id || Number(r.primary_key);
      return childIds.has(pk);
    });
  }, [activeRowsByType, currentDiveParent]);

  // Filter Pipeline
  const filteredRows = useMemo(() => {
    return scopedRowsByDive.filter((row) => {
      // 1. Top Risk Filter
      if (
        filterState.topRiskOnly &&
        !(row.is_top_risk || row.risktoprisk === 1 || row.css_toprisk?.includes('toprisk'))
      ) {
        return false;
      }

      // 2. Criticality Differs / Reassessed Filter
      if (filterState.criticalityDiffersOnly && !isCriticalityDiffers(row)) {
        return false;
      }

      // 3. Status Filter
      const rowStatus = (row.riskstatus || 'Draft').toLowerCase();
      const isStatusMatch = filterState.statuses.some((s) => s.toLowerCase() === rowStatus);
      if (!isStatusMatch) return false;

      // 4. Trend Filter
      if (filterState.trends && filterState.trends.length > 0) {
        const rowTrend = getRowTrendLabel(row);
        if (!filterState.trends.some((t) => t.toLowerCase() === rowTrend.toLowerCase())) return false;
      }

      // 5. New Top Risk Filter
      if (!isNewTopRiskMatch(row, filterState.newTopRisk)) {
        return false;
      }

      // 6. ARM Risk Category Filter
      if (filterState.categories && filterState.categories.length > 0) {
        const rowCats: string[] = Array.isArray(row.categories) ? row.categories : [];
        if (!filterState.categories.some((c) => rowCats.includes(c))) return false;
      }

      // 7. Impact Category Filter
      if (filterState.impactCurrentCategory && filterState.impactCurrentCategory.length > 0) {
        const rowImpactCats: string[] = Array.isArray(row.impactCurrentCategory) ? row.impactCurrentCategory : [];
        if (!filterState.impactCurrentCategory.some((c) => rowImpactCats.includes(c))) return false;
      }

      // 8. Level 1 Siglum Color Legend Filter
      if (selectedSiglumColors.length > 0) {
        const siglum = getRowLevel1(row);
        if (!siglum || !selectedSiglumColors.includes(siglum)) return false;
      }

      // 9. Fast Keyword Search using search_rows
      if (searchText.trim()) {
        const query = searchText.toLowerCase().trim();
        const pkKey = String(row.pk_impact_id || row.primary_key || '');

        if (armRoPayload?.search_rows && typeof armRoPayload.search_rows[pkKey] === 'string') {
          if (!armRoPayload.search_rows[pkKey].includes(query)) return false;
        } else {
          const id = String(row.riskid_raw || row.pk_impact_id || '').toLowerCase();
          const title = String(row.risktitle || row.arm_title || '').toLowerCase();
          const desc = String(row.riskdescription || row.arm_description || '').toLowerCase();
          const owner = String(row.siglum_owner || '').toLowerCase();
          const perimeter = String(row.arm_perimeter || row.riskperimeter || '').toLowerCase();

          const matches =
            id.includes(query) ||
            title.includes(query) ||
            desc.includes(query) ||
            owner.includes(query) ||
            perimeter.includes(query);

          if (!matches) return false;
        }
      }

      return true;
    });
  }, [scopedRowsByDive, filterState, selectedSiglumColors, searchText, armRoPayload?.search_rows]);

  // Unassigned Score 0 / Without Score Risks
  const unassignedScoreZeroRows = useMemo(() => {
    return filteredRows.filter((row) => {
      const rawScore = Math.abs(row.riskscore ?? row.arm_score ?? 0);
      return Math.round(rawScore) === 0;
    });
  }, [filteredRows]);

  // Map Filtered Rows into Matrix Cell Bucket IDs (1..16)
  const cellItemsMap = useMemo(() => {
    const map = new Map<number, ArmRiskRow[]>();
    for (let i = 1; i <= 16; i++) {
      map.set(i, []);
    }

    filteredRows.forEach((row) => {
      const rawScore = Math.abs(row.riskscore ?? row.arm_score ?? 0);
      const cellId = Math.min(Math.max(Math.round(rawScore), 1), 16);
      if (map.has(cellId)) {
        map.get(cellId)!.push(row);
      }
    });

    return map;
  }, [filteredRows]);

  // Dynamic Axis Labels & Grid Matrix Configuration
  const isOpportunityMode = selectedType === 'Opportunity';

  const probabilityLabels = ['Nearly Certain', 'Likely', 'Possible', 'Unlikely'];
  const impactLabels = isOpportunityMode
    ? ['Very High', 'High', 'Medium', 'Low']
    : ['Low', 'Medium', 'High', 'Very High'];

  // 4x4 Matrix Cell Color Schemes
  const matrixGrid = useMemo<MatrixCellConfig[][]>(() => {
    if (isOpportunityMode) {
      return [
        [
          { id: 1, bg: 'bg-[#1d5375] text-white', gridRow: 0, gridCol: 0 },
          { id: 3, bg: 'bg-[#2b80b9] text-white', gridRow: 0, gridCol: 1 },
          { id: 7, bg: 'bg-[#5ca8db] text-slate-900', gridRow: 0, gridCol: 2 },
          { id: 12, bg: 'bg-[#5ca8db] text-slate-900', gridRow: 0, gridCol: 3 },
        ],
        [
          { id: 2, bg: 'bg-[#1d5375] text-white', gridRow: 1, gridCol: 0 },
          { id: 5, bg: 'bg-[#2b80b9] text-white', gridRow: 1, gridCol: 1 },
          { id: 9, bg: 'bg-[#5ca8db] text-slate-900', gridRow: 1, gridCol: 2 },
          { id: 13, bg: 'bg-[#a2d2f2] text-slate-900', gridRow: 1, gridCol: 3 },
        ],
        [
          { id: 4, bg: 'bg-[#2b80b9] text-white', gridRow: 2, gridCol: 0 },
          { id: 6, bg: 'bg-[#2b80b9] text-white', gridRow: 2, gridCol: 1 },
          { id: 11, bg: 'bg-[#5ca8db] text-slate-900', gridRow: 2, gridCol: 2 },
          { id: 15, bg: 'bg-[#a2d2f2] text-slate-900', gridRow: 2, gridCol: 3 },
        ],
        [
          { id: 8, bg: 'bg-[#5ca8db] text-slate-900', gridRow: 3, gridCol: 0 },
          { id: 10, bg: 'bg-[#5ca8db] text-slate-900', gridRow: 3, gridCol: 1 },
          { id: 14, bg: 'bg-[#a2d2f2] text-slate-900', gridRow: 3, gridCol: 2 },
          { id: 16, bg: 'bg-[#a2d2f2] text-slate-900', gridRow: 3, gridCol: 3 },
        ],
      ];
    }

    return [
      [
        { id: 12, bg: 'bg-[#E6E066]', gridRow: 0, gridCol: 0 },
        { id: 7, bg: 'bg-[#E6E066]', gridRow: 0, gridCol: 1 },
        { id: 3, bg: 'bg-[#FFA048]', gridRow: 0, gridCol: 2 },
        { id: 1, bg: 'bg-[#F26B7A]', gridRow: 0, gridCol: 3 },
      ],
      [
        { id: 13, bg: 'bg-[#A6DB6D]', gridRow: 1, gridCol: 0 },
        { id: 9, bg: 'bg-[#E6E066]', gridRow: 1, gridCol: 1 },
        { id: 5, bg: 'bg-[#FFA048]', gridRow: 1, gridCol: 2 },
        { id: 2, bg: 'bg-[#F26B7A]', gridRow: 1, gridCol: 3 },
      ],
      [
        { id: 15, bg: 'bg-[#A6DB6D]', gridRow: 2, gridCol: 0 },
        { id: 11, bg: 'bg-[#E6E066]', gridRow: 2, gridCol: 1 },
        { id: 6, bg: 'bg-[#FFA048]', gridRow: 2, gridCol: 2 },
        { id: 4, bg: 'bg-[#FFA048]', gridRow: 2, gridCol: 3 },
      ],
      [
        { id: 16, bg: 'bg-[#A6DB6D]', gridRow: 3, gridCol: 0 },
        { id: 14, bg: 'bg-[#A6DB6D]', gridRow: 3, gridCol: 1 },
        { id: 10, bg: 'bg-[#E6E066]', gridRow: 3, gridCol: 2 },
        { id: 8, bg: 'bg-[#E6E066]', gridRow: 3, gridCol: 3 },
      ],
    ];
  }, [isOpportunityMode]);

  const handleTypeChange = (type: 'Risk' | 'Opportunity') => {
    logger.info('useDashboardMapsTab', `Changed view mode to: ${type}`);
    setSelectedType(type);
    setSelectedSiglumColorFilters([]);
  };

  const handleDisplayChange = (display: 'Id' | 'Title') => {
    logger.info('useDashboardMapsTab', `Changed display mode to: ${display}`);
    setSelectedDisplay(display);
  };

  const toggleSiglumColorFilter = useCallback(
    (siglum: string) => {
      setSelectedSiglumColorFilters((prev) => {
        const next = prev.includes(siglum) ? prev.filter((s) => s !== siglum) : [...prev, siglum];
        // All selected == show everything
        return next.length >= level1LegendItems.length ? [] : next;
      });
    },
    [level1LegendItems.length],
  );

  const clearSiglumColorFilter = useCallback(() => setSelectedSiglumColorFilters([]), []);

  const handleDive = useCallback((risk: ArmRiskRow) => {
    logger.info('useDashboardMapsTab', `Diving into parent risk: ${risk.riskid_raw}`);
    setDiveStack((prev) => [...prev, risk]);
  }, []);

  const handleUndive = useCallback(() => {
    setDiveStack((prev) => prev.slice(0, -1));
  }, []);

  const handleResetDive = useCallback(() => {
    setDiveStack([]);
  }, []);

  return {
    isFilterOpen,
    setIsFilterOpen,
    filterState,
    setFilterState,
    selectedType,
    selectedDisplay,
    matchMode,
    setMatchMode,
    searchText,
    setSearchText,
    timelineRange,
    setTimelineRange,
    selectedSiglumColors,
    toggleSiglumColorFilter,
    clearSiglumColorFilter,
    level1LegendItems,
    probabilityLabels,
    impactLabels,
    matrixGrid,
    risksList,
    oppsList,
    filteredRows,
    cellItemsMap,
    unassignedScoreZeroRows,
    diveStack,
    currentDiveParent,
    handleDive,
    handleUndive,
    handleResetDive,
    editingRisk,
    setEditingRisk,
    allRiskRows,
    isLoadingPayload,
    payloadError,
    handleTypeChange,
    handleDisplayChange,
  };
}



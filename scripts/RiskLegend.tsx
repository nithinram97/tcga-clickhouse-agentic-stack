import React from 'react';
import { X } from 'lucide-react';
import { Badge } from '../../../@/components/ui/badge';
import { cn } from '../../../@/lib/utils';
import type { Level1LegendItem } from '../../hooks/useDashboardMapsTab';

interface RiskLegendProps {
  level1LegendItems: Level1LegendItem[];
  selectedSiglumColors: string[];
  onToggleSiglumColor: (_siglum: string) => void;
  onClearSiglumColors?: () => void;
}

export const RiskLegend: React.FC<RiskLegendProps> = ({
  level1LegendItems = [],
  selectedSiglumColors,
  onToggleSiglumColor,
  onClearSiglumColors,
}) => {
  if (!level1LegendItems.length) return null;

  const isFiltering = selectedSiglumColors.length > 0;

  return (
    <div className="flex items-center gap-1.5 flex-wrap ml-auto shrink-0 select-none">
      {level1LegendItems.map((item) => {
        const isSelected = selectedSiglumColors.includes(item.siglum);
        // With no filter every siglum is "shown"; with a filter, unselected ones are dimmed.
        const isDimmed = isFiltering && !isSelected;

        return (
          <Badge
            key={item.siglum}
            variant="outline"
            role="button"
            aria-pressed={isSelected}
            title={isSelected ? `Remove ${item.siglum} from filter` : `Show only ${item.siglum} (click more to add)`}
            onClick={() => onToggleSiglumColor(item.siglum)}
            className={cn(
              'text-[10px] px-2 py-0.5 font-semibold border cursor-pointer transition-all flex items-center gap-1.5',
              isSelected
                ? 'bg-airbus-navy text-white border-airbus-navy shadow-2xs'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100',
              isDimmed && 'opacity-45 hover:opacity-80',
            )}
          >
            <span
              className={cn('h-2 w-2 rounded-full shrink-0', isSelected && 'ring-1 ring-white')}
              style={{ backgroundColor: item.color }}
            />
            <span>{item.siglum}</span>
            <span className="text-[9px] font-mono opacity-80">({item.count})</span>
          </Badge>
        );
      })}

      {isFiltering && onClearSiglumColors && (
        <button
          type="button"
          onClick={onClearSiglumColors}
          title="Clear siglum filter"
          className="flex h-5 cursor-pointer items-center gap-0.5 rounded px-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <X className="h-3 w-3" /> Clear
        </button>
      )}
    </div>
  );
};

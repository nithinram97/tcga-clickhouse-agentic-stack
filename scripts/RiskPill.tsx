
import React, { useState } from 'react';
import { AlertTriangle, Pencil, CornerDownRight, FileText } from 'lucide-react';
import { cn } from '../../../@/lib/utils';
import type { ArmRiskRow } from '../../context/DashboardContext';
import { Popover, PopoverContent, PopoverTrigger } from '../../../@/components/ui/popover';
import { Button } from '../../../@/components/ui/button';
import { getScoreCode, getTrendConfig, isCriticalityDiffers } from '../../utils/reportTableUtils';
import { getRowLevel1, useSiglumColor } from '../../utils/siglumColors';

interface RiskPillProps {
  risk: ArmRiskRow;
  displayMode?: 'Id' | 'Title';
  onClick?: (_risk: ArmRiskRow) => void;
  onDive?: (_risk: ArmRiskRow) => void;
  onEdit?: (_risk: ArmRiskRow) => void;
  onViewOnepager?: (_risk: ArmRiskRow) => void;
  className?: string;
}

export const RiskPill: React.FC<RiskPillProps> = ({
  risk,
  displayMode = 'Id',
  onClick,
  onDive,
  onEdit,
  onViewOnepager,
  className,
}) => {
  const [popoverOpen, setPopoverOpen] = useState(false);

  const riskId = risk.riskid_raw || risk.pk_impact_id || '';
  const title = risk.risktitle || risk.arm_title || '';

  const isReassessed = isCriticalityDiffers(risk);

  const level1Color = useSiglumColor(risk);
  const hasChildren = Array.isArray(risk.list_items) && risk.list_items.length > 0;

  const displayText = displayMode === 'Id' ? riskId : title;
  const formattedScore = getScoreCode(risk.riskscore ?? risk.arm_score);

  const trendConf = getTrendConfig(risk.Trend);

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(risk);
        }}
        title={`${riskId} - ${title}${getRowLevel1(risk) ? ` (${getRowLevel1(risk)})` : ''}`}
        className={cn(
          'group relative inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[10px] font-mono font-medium',
          'bg-white text-slate-800 border border-slate-200 shadow-2xs hover:shadow-xs transition-all cursor-pointer',
          'hover:border-slate-400 hover:scale-[1.02] active:scale-100 select-none max-w-full truncate overflow-hidden leading-tight',
          className,
        )}
      >
        {/* Function / Level 1 Left Crescent Background Accent */}
        {level1Color && (
          <span
            className="absolute left-0 top-0 bottom-0 w-2 rounded-l-full pointer-events-none opacity-80"
            style={{
              background: `radial-gradient(circle at -50% 50%, ${level1Color} 70%, transparent 80%)`,
              backgroundColor: level1Color,
            }}
          />
        )}

        {/* Criticality Differs Warning Icon */}
        {isReassessed && (
          <span
            className="text-amber-500 shrink-0"
            title={`Criticality differs from ARM (ARM: ${getScoreCode(risk.arm_score)})`}
          >
            <AlertTriangle className="h-2.5 w-2.5 fill-amber-400 text-amber-700" />
          </span>
        )}

        {/* Display Text (Risk ID or Title) */}
        <span className={cn('truncate max-w-28 font-semibold', level1Color && 'pl-1')}>{displayText}</span>

        {/* Prominent Right Arrow / Trend Indicator */}
        <span
          className="shrink-0 flex items-center justify-center text-slate-800 ml-0.5"
          title={`Trend: ${trendConf.label}`}
        >
          {trendConf.icon}
        </span>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-2.5 space-y-2 z-30" align="start">
        <div className="border-b border-slate-100 pb-1.5">
          <div className="font-bold text-xs text-airbus-navy font-mono flex items-center justify-between">
            <span>#{riskId}</span>
            {risk.siglum_owner && (
              <span className="text-[10px] px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">{risk.siglum_owner}</span>
            )}
          </div>
          <div className="text-[11px] text-slate-600 font-medium line-clamp-2 leading-tight mt-0.5">{title}</div>
        </div>

        <div className="flex items-center justify-between gap-1 text-[11px] text-slate-500 font-mono">
          <span>Score: {formattedScore}</span>
          <span className="flex items-center gap-1">
            Trend: {trendConf.icon} {trendConf.label}
          </span>
        </div>

        {/* Quick Actions Toolbar */}
        <div className="flex items-center gap-1 pt-1 border-t border-slate-100">
          {onEdit && (
            <Button
              variant="outline"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                setPopoverOpen(false);
                onEdit(risk);
              }}
              className="flex-1 h-7 text-[10px] gap-1 cursor-pointer"
            >
              <Pencil className="h-3 w-3 text-airbus-blue" />
              <span>Edit</span>
            </Button>
          )}

          {hasChildren && onDive && (
            <Button
              variant="outline"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                setPopoverOpen(false);
                onDive(risk);
              }}
              className="flex-1 h-7 text-[10px] gap-1 cursor-pointer bg-amber-50 border-amber-200 text-amber-800"
            >
              <CornerDownRight className="h-3 w-3 text-amber-600" />
              <span>Dive ({risk.list_items?.length})</span>
            </Button>
          )}

          {onViewOnepager && (
            <Button
              variant="outline"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                setPopoverOpen(false);
                onViewOnepager(risk);
              }}
              className="flex-1 h-7 text-[10px] gap-1 cursor-pointer"
            >
              <FileText className="h-3 w-3 text-slate-600" />
              <span>One Pager</span>
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};




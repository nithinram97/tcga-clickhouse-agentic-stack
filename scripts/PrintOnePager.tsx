import React, { useMemo } from 'react';
import { cn } from '../../../../@/lib/utils';
import type { ActionRow, ArmRiskRow } from '../../../context/DashboardContext';
import type { MitigationColumnDefinition } from '../../../types/dashboardSettings';
import { getScoreLevelAndColor, getTrendConfig } from '../../../utils/reportTableUtils';
import {
  getActionParentPk,
  getPanelSizes,
  getRowDisplayId,
  getRowPk,
  getRowTitle,
  isOpportunityRow,
  type OnePagerComponentId,
  type OnePagerPrintConfig,
} from '../../../utils/reportPrintUtils';
import { EmptyNote, FitToBox, Panel, ReportPage, Split, type ReportMeta } from './ReportPrimitives';
import { PrintMiniMatrix } from './PrintMatrix';
import { PrintWaterfall } from './PrintWaterfall';
import { ActionTable } from './PrintTables';
import { RICH_HTML_CLASSES } from './reportStyles';

interface PrintOnePagerProps {
  meta: ReportMeta;
  risk: ArmRiskRow;
  config: OnePagerPrintConfig;
  actions: ActionRow[];
  actionColumns: MitigationColumnDefinition[];
  actionCellValues: Record<string, string>;
}

const splitLines = (v: unknown): string[] =>
  String(v || '')
    .split('\n')
    .map((s) => s.replace(/^[•\-*]\s*/, '').trim())
    .filter(Boolean);

/* ---------------- Panels ---------------- */

const ArmText: React.FC<{ risk: ArmRiskRow; mode: 'full' | 'description' | 'causesEffects' }> = ({ risk, mode }) => {
  const causes = splitLines(risk.riskcause);
  const effects = splitLines(risk.riskeffect);
  const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="space-y-[0.8mm]">
      <h4 className="text-[9.5px] font-bold uppercase tracking-wide text-[#00205B]">{title}</h4>
      {children}
    </div>
  );
  const List: React.FC<{ items: string[]; empty: string }> = ({ items, empty }) =>
    items.length ? (
      <ul className="list-disc space-y-[0.3mm] pl-[4mm]">
        {items.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    ) : (
      <p className="italic text-slate-400">{empty}</p>
    );

  return (
    <div className="space-y-[2.5mm] text-[9.5px] leading-snug text-slate-800">
      {mode !== 'causesEffects' && (
        <Section title="Description">
          <p className="whitespace-pre-line text-justify">{risk.riskdescription || risk.arm_description || 'No description provided.'}</p>
        </Section>
      )}
      {mode !== 'description' && (
        <>
          <Section title="Causes">
            <List items={causes} empty="No causes registered." />
          </Section>
          <Section title="Effects">
            <List items={effects} empty="No effects registered." />
          </Section>
        </>
      )}
    </div>
  );
};

const STATUS_EMOJI: Record<string, { emoji: string; label: string }> = {
  green: { emoji: '😊', label: 'On track' },
  yellow: { emoji: '😐', label: 'Needs attention' },
  red: { emoji: '😡', label: 'Critical' },
};
const CONFIDENCE_COLORS: Record<string, string> = {
  'very-high': '#03B075',
  high: '#FFC107',
  medium: '#FF8F2E',
  low: '#EF5350',
};

const KeyMessages: React.FC<{ risk: ArmRiskRow; showAssessment: boolean; showReview: boolean }> = ({
  risk,
  showAssessment,
  showReview,
}) => {
  const trend = getTrendConfig(risk.Trend ?? risk.trend);
  const status = STATUS_EMOJI[String(risk.status_header || 'yellow')] || STATUS_EMOJI.yellow;
  const confKey = String(risk.confidence_level || risk.confidenceLevel || '').toLowerCase();
  const confColor = CONFIDENCE_COLORS[confKey];
  const html = String(risk.risk_comment || '');

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[1mm] border border-slate-300 bg-white">
      <div className="grid shrink-0 grid-cols-3 bg-[#00205B] text-white">
        <div className="flex flex-col items-center border-r border-white/20 py-[0.8mm]">
          <span className="text-[7.5px] font-semibold">Trend</span>
          <span className="flex items-center gap-[0.6mm] text-[8px] [&_svg]:h-[2.8mm] [&_svg]:w-[2.8mm] [&_svg]:text-white">
            {trend.icon}
            {trend.label}
          </span>
        </div>
        <div className="flex flex-col items-center border-r border-white/20 py-[0.8mm]">
          <span className="text-[7.5px] font-semibold">Status</span>
          <span className="text-[11px] leading-none" title={status.label}>
            {status.emoji}
          </span>
        </div>
        <div className="flex flex-col items-center py-[0.8mm]">
          <span className="text-[7.5px] font-semibold">Confidence</span>
          <span className="flex items-center gap-[0.8mm] text-[8px]">
            <span
              className="h-[2.6mm] w-[2.6mm] rounded-full border-2"
              style={{ borderColor: confColor || '#ffffff' }}
            />
            {confKey ? confKey.replace('-', ' ') : '-'}
          </span>
        </div>
      </div>
      <div className="shrink-0 border-b border-slate-200 bg-slate-50 py-[0.6mm] text-center text-[8.5px] font-extrabold uppercase tracking-wider text-slate-800">
        Key Messages
      </div>
      <div className="min-h-0 flex-1 p-[1.5mm]">
        <FitToBox>
          <div className="space-y-[2mm]">
            {html.trim() ? (
              <div className={RICH_HTML_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className="text-[9px] italic text-slate-400">No key messages recorded.</p>
            )}
            {showAssessment && (
              <TextBlock title="Assessment Justification" text={risk.assessment_justification} />
            )}
            {showReview && <TextBlock title="Last Review Comment" text={risk.lastreviewcomments} />}
          </div>
        </FitToBox>
      </div>
    </div>
  );
};

const TextBlock: React.FC<{ title: string; text: unknown }> = ({ title, text }) => (
  <div className="border-t border-slate-200 pt-[1.2mm]">
    <div className="mb-[0.6mm] text-[8px] font-extrabold uppercase tracking-wider text-[#00205B]">{title}</div>
    <p className="whitespace-pre-line rounded-[0.6mm] border border-slate-200 bg-slate-50 p-[1.2mm] text-[9px] leading-snug text-slate-700">
      {String(text || '').trim() || 'Nothing recorded.'}
    </p>
  </div>
);

/* ---------------- OnePager ---------------- */

export const PrintOnePager: React.FC<PrintOnePagerProps> = ({
  meta,
  risk,
  config,
  actions,
  actionColumns,
  actionCellValues,
}) => {
  const isOpp = isOpportunityRow(risk);
  const pk = getRowPk(risk);
  const displayId = getRowDisplayId(risk);
  const riskActions = useMemo(() => actions.filter((a) => getActionParentPk(a) === pk), [actions, pk]);

  const renderComponent = (id: OnePagerComponentId, pageKey?: 'page1' | 'page2') => {
    switch (id) {
      case 'armInfo':
        return (
          <Panel title="Description, Causes & Effects">
            <FitToBox>
              <ArmText risk={risk} mode="full" />
            </FitToBox>
          </Panel>
        );
      case 'heatmap':
        return (
          <Panel title={isOpp ? 'Coldmap' : 'Heatmap'}>
            <PrintMiniMatrix risk={risk} isOpp={isOpp} />
          </Panel>
        );
      case 'waterfall':
        return (
          <Panel title="Waterfall">
            <PrintWaterfall riskPkId={pk} isOpp={isOpp} method={config.waterfallMethod} range={config.waterfallRange} />
          </Panel>
        );
      case 'actionTracker':
        return (
          <Panel title={`Action Tracker (${riskActions.length})`}>
            {riskActions.length ? (
              <FitToBox>
                <ActionTable
                  actions={riskActions}
                  columns={actionColumns}
                  cellValues={actionCellValues}
                  parentIdFor={() => displayId}
                  compact
                />
              </FitToBox>
            ) : (
              <EmptyNote>No mitigation actions registered.</EmptyNote>
            )}
          </Panel>
        );
      case 'keyMessages': {
        const inLayout3 = config.layout === 3 && pageKey;
        return (
          <KeyMessages
            risk={risk}
            showAssessment={config.showAssessment && (!inLayout3 || config.assessmentPages[pageKey!])}
            showReview={config.showReviewComment && (!inLayout3 || config.reviewCommentPages[pageKey!])}
          />
        );
      }
    }
  };

  const size = (layoutKey: string, groupKey: string, fallback: number[]) =>
    getPanelSizes(config, layoutKey, groupKey, fallback);

  const pages: React.ReactNode[] = [];

  if (config.layout === 3) {
    pages.push(
      <Split dir="row" sizes={size('layout3_page1', 'mainHorizontal', [68, 32])}>
        {[
          <Split key="l" dir="col" sizes={size('layout3_page1', 'leftVertical', [50, 50])}>
            {[
              <Split key="t" dir="row" sizes={size('layout3_page1', 'topHorizontal', [50, 50])}>
                {[
                  <Panel key="d" title="Description">
                    <FitToBox>
                      <ArmText risk={risk} mode="description" />
                    </FitToBox>
                  </Panel>,
                  <React.Fragment key="h">{renderComponent('heatmap')}</React.Fragment>,
                ]}
              </Split>,
              <Panel key="ce" title="Causes & Effects">
                <FitToBox>
                  <ArmText risk={risk} mode="causesEffects" />
                </FitToBox>
              </Panel>,
            ]}
          </Split>,
          <React.Fragment key="r">{renderComponent('keyMessages', 'page1')}</React.Fragment>,
        ]}
      </Split>,
    );
    pages.push(
      <Split dir="row" sizes={size('layout3_page2', 'mainHorizontal', [68, 32])}>
        {[
          <Split key="l" dir="col" sizes={size('layout3_page2', 'leftVertical', [50, 50])}>
            {[
              <React.Fragment key="w">{renderComponent('waterfall')}</React.Fragment>,
              <React.Fragment key="a">{renderComponent('actionTracker')}</React.Fragment>,
            ]}
          </Split>,
          <React.Fragment key="r">{renderComponent('keyMessages', 'page2')}</React.Fragment>,
        ]}
      </Split>,
    );
  } else if (config.layout === 4) {
    const c = config.customComponents;
    const r = (i: number) => <React.Fragment key={i}>{renderComponent(c[i])}</React.Fragment>;
    const L = 'layout4';
    let body: React.ReactNode;
    if (c.length === 0) body = <EmptyNote>No components selected for this custom layout.</EmptyNote>;
    else if (c.length === 1) body = r(0);
    else if (c.length === 2) body = <Split dir="row" sizes={size(L, 'mainHorizontal', [50, 50])}>{[r(0), r(1)]}</Split>;
    else if (c.length === 3)
      body = (
        <Split dir="row" sizes={size(L, 'mainHorizontal', [68, 32])}>
          {[
            <Split key="l" dir="col" sizes={size(L, 'leftVertical', [50, 50])}>{[r(0), r(1)]}</Split>,
            r(2),
          ]}
        </Split>
      );
    else if (c.length === 4)
      body = (
        <Split dir="row" sizes={size(L, 'mainHorizontal', [50, 50])}>
          {[
            <Split key="l" dir="col" sizes={size(L, 'leftVertical', [50, 50])}>{[r(0), r(1)]}</Split>,
            <Split key="r" dir="col" sizes={size(L, 'rightVertical', [50, 50])}>{[r(2), r(3)]}</Split>,
          ]}
        </Split>
      );
    else
      body = (
        <Split dir="row" sizes={size(L, 'mainHorizontal', [68, 32])}>
          {[
            <Split key="l" dir="col" sizes={size(L, 'leftVertical', [50, 50])}>
              {[
                <Split key="t" dir="row" sizes={size(L, 'topHorizontal', [50, 50])}>{[r(0), r(1)]}</Split>,
                <Split key="b" dir="row" sizes={size(L, 'bottomHorizontal', [50, 50])}>{[r(2), r(3)]}</Split>,
              ]}
            </Split>,
            r(4),
          ]}
        </Split>
      );
    pages.push(body);
  } else if (config.layout === 2) {
    const s = config.slots;
    pages.push(
      <Split dir="row" sizes={size('layout2', 'mainHorizontal', [28, 44, 28])}>
        {[
          <React.Fragment key="l">{renderComponent(s.slotTopLeft)}</React.Fragment>,
          <Split key="c" dir="col" sizes={size('layout2', 'centerVertical', [50, 50])}>
            {[
              <React.Fragment key="t">{renderComponent(s.slotTopCenter)}</React.Fragment>,
              <React.Fragment key="b">{renderComponent(s.slotBottomCenter)}</React.Fragment>,
            ]}
          </Split>,
          <React.Fragment key="r">{renderComponent(s.slotRight)}</React.Fragment>,
        ]}
      </Split>,
    );
  } else {
    const s = config.slots;
    pages.push(
      <Split dir="row" sizes={size('layout1', 'mainHorizontal', [68, 32])}>
        {[
          <Split key="l" dir="col" sizes={size('layout1', 'leftVertical', [58, 42])}>
            {[
              <Split key="t" dir="row" sizes={size('layout1', 'topLeftHorizontal', [50, 50])}>
                {[
                  <React.Fragment key="a">{renderComponent(s.slotTopLeft)}</React.Fragment>,
                  <React.Fragment key="b">{renderComponent(s.slotTopCenter)}</React.Fragment>,
                ]}
              </Split>,
              <Split key="b" dir="row" sizes={size('layout1', 'bottomLeftHorizontal', [50, 50])}>
                {[
                  <React.Fragment key="a">{renderComponent(s.slotBottomLeft)}</React.Fragment>,
                  <React.Fragment key="b">{renderComponent(s.slotBottomCenter)}</React.Fragment>,
                ]}
              </Split>,
            ]}
          </Split>,
          <React.Fragment key="r">{renderComponent(s.slotRight)}</React.Fragment>,
        ]}
      </Split>,
    );
  }

  const score = risk.riskscore_display ?? risk.riskscore ?? risk.arm_score;
  const lvl = getScoreLevelAndColor(score as number, isOpp ? 'Opportunity' : 'Risk');

  return (
    <>
      {pages.map((body, i) => (
        <ReportPage
          key={i}
          meta={meta}
          fit={false}
          heading={
            <span className="flex items-baseline gap-[2mm]">
              <span className={cn('font-mono', isOpp ? 'text-[#0055c8]' : 'text-[#DA1884]')}>#{displayId}</span>
              <span>{getRowTitle(risk)}</span>
            </span>
          }
          headingRight={
            <span className="flex items-center gap-[1.5mm] text-[8.5px]">
              {pages.length > 1 && <span className="text-slate-500">Page {i + 1}/{pages.length}</span>}
              {risk.siglum_owner && (
                <span className="rounded-[0.6mm] border border-slate-300 px-[1.2mm] py-[0.2mm] text-slate-700">{risk.siglum_owner}</span>
              )}
              <span
                className={cn(
                  'rounded-full border px-[1.5mm] py-[0.2mm] font-semibold',
                  isOpp ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-red-300 bg-red-50 text-red-700',
                )}
              >
                {isOpp ? 'Opportunity' : 'Risk'}
              </span>
              <span className={cn('rounded-[0.6mm] border px-[1.2mm] py-[0.2mm] font-mono', lvl.badgeCss)}>{lvl.levelCode}</span>
              {risk.riskstatus && <span className="text-slate-600">{risk.riskstatus}</span>}
            </span>
          }
        >
          {body}
        </ReportPage>
      ))}
    </>
  );
};

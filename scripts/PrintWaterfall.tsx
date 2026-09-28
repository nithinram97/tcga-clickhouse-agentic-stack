import React, { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../../../@/lib/utils';
import { useWaterfallData } from '../../../hooks/useWaterfallData';

interface PrintWaterfallProps {
  riskPkId: number;
  isOpp: boolean;
  method: 'percentages' | 'target';
  range: [string, string];
}

type Shape = 'pin' | 'circle' | 'square' | 'ring' | 'diamond' | 'target' | 'triangle';

const parseLocalDate = (s: string): Date => {
  const [y, m, d] = (s || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : new Date(s);
};

const markerConfig = (isOpp: boolean): Record<string, { label: string; stroke: string; fill: string; shape: Shape; dashed?: boolean }> => {
  const t = isOpp ? '#FFB800' : '#00838F';
  const tb = isOpp ? '#E6A100' : '#005F73';
  return {
    planned: { label: 'Planned', stroke: '#000000', fill: '#000000', shape: 'pin', dashed: true },
    achieved: { label: 'Achieved', stroke: '#8B6508', fill: '#D4AF37', shape: 'circle' },
    current: { label: 'Current', stroke: '#DA1884', fill: '#FFFFFF', shape: 'square' },
    originalCriticality: { label: 'Original criticality', stroke: '#000000', fill: '#FFFFFF', shape: 'ring' },
    currentCriticality: { label: 'Current criticality', stroke: '#000000', fill: '#FFFFFF', shape: 'diamond' },
    target: { label: 'Target', stroke: tb, fill: t, shape: 'target', dashed: true },
    currentTarget: { label: 'Current target', stroke: tb, fill: t, shape: 'triangle' },
    originalTarget: { label: 'Original target', stroke: tb, fill: '#FFFFFF', shape: 'triangle' },
  };
};

const Marker: React.FC<{ shape: Shape; stroke: string; fill: string; size?: number }> = ({ shape, stroke, fill, size = 9 }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" className="block overflow-visible">
    {shape === 'pin' && <path d="M5 10 L2 5 A3 3 0 1 1 8 5 Z" fill={fill} stroke={stroke} strokeWidth="0.8" />}
    {shape === 'circle' && <circle cx="5" cy="5" r="4" fill={fill} stroke={stroke} strokeWidth="1.2" />}
    {shape === 'ring' && <circle cx="5" cy="5" r="4" fill={fill} stroke={stroke} strokeWidth="1.5" />}
    {shape === 'square' && <rect x="1" y="1" width="8" height="8" fill={fill} stroke={stroke} strokeWidth="1.8" />}
    {shape === 'diamond' && <path d="M5 0.5 L9.5 5 L5 9.5 L0.5 5 Z" fill={fill} stroke={stroke} strokeWidth="1.3" />}
    {shape === 'target' && <rect x="1" y="1" width="8" height="8" rx="1.5" fill={fill} stroke={stroke} strokeWidth="1" />}
    {shape === 'triangle' && <path d="M5 1 L9.5 9 L0.5 9 Z" fill={fill} stroke={stroke} strokeWidth="1.2" />}
  </svg>
);

export const PrintWaterfall: React.FC<PrintWaterfallProps> = ({ riskPkId, isOpp, method, range }) => {
  const { data, isLoading, error } = useWaterfallData({ riskPkId, method, startDate: range[0], endDate: range[1] });
  const markers = useMemo(() => markerConfig(isOpp), [isOpp]);

  const months = useMemo(() => {
    const first = parseLocalDate(range[0]);
    const last = parseLocalDate(range[1]);
    const out: { key: string; label: string; year: string; y: number; m: number }[] = [];
    let y = first.getFullYear();
    let m = first.getMonth();
    while ((y < last.getFullYear() || (y === last.getFullYear() && m <= last.getMonth())) && out.length < 240) {
      const dt = new Date(y, m, 1);
      out.push({ key: `${y}-${m}`, label: dt.toLocaleDateString('en-US', { month: 'short' }), year: String(y).slice(-2), y, m });
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }
    return out.length ? out : [{ key: 'x', label: '', year: '', y: first.getFullYear(), m: first.getMonth() }];
  }, [range]);

  const coords = (dateISO: string, score: number) => {
    const d = parseLocalDate(dateISO);
    const idx = months.findIndex((mm) => mm.y === d.getFullYear() && mm.m === d.getMonth());
    const n = months.length;
    const x = idx === -1 ? 50 : 100 * ((1 + 2 * idx) / (2 * n) + (d.getDate() - 15.5) / (31 * n));
    const y = ((Math.min(Math.max(score, 1), 16) - 0.5) / 16) * 100;
    return { x, y };
  };

  const series = useMemo(() => {
    const out: [string, { date: string; score: number }[]][] = [];
    Object.entries(data?.series || {}).forEach(([k, pts]) => {
      if (pts?.length) out.push([k, [...pts].sort((a, b) => parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime())]);
    });
    return out;
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[9px] text-slate-500">
        <Loader2 className="mr-[1mm] h-[3mm] w-[3mm] animate-spin" /> Loading waterfall…
      </div>
    );
  }
  if (error || !data || series.length === 0) {
    return <div className="flex h-full items-center justify-center text-[9px] italic text-slate-400">No waterfall trajectory data.</div>;
  }

  const labelEvery = months.length > 24 ? 3 : months.length > 14 ? 2 : 1;
  const bands = isOpp
    ? ['#00205B', '#0072CE', '#80D8FF', '#E0F7FA']
    : ['#EF5350', '#FFA726', '#FFEE58', '#9CCC65'];
  const bandHeights = [12.5, 25, 37.5, 25];

  return (
    <div className="flex h-full w-full min-h-0 flex-col gap-[0.8mm]">
      <div className="flex items-center justify-between text-[7.5px] text-slate-500">
        <span className="font-mono">
          {range[0]} → {range[1]}
        </span>
        <span>
          Method: <strong className="text-[#DA1884]">{method === 'target' ? 'Target (123)' : 'Percentages (%)'}</strong>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Y axis */}
        <div className="flex w-[3.5mm] shrink-0 flex-col border-r border-slate-300 bg-slate-50">
          {Array.from({ length: 16 }, (_, i) => (
            <div key={i} className="flex flex-1 items-center justify-center font-mono text-[6px] font-bold text-slate-600">
              {i + 1}
            </div>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-0 flex flex-col">
            {bands.map((c, i) => (
              <div key={i} style={{ height: `${bandHeights[i]}%`, backgroundColor: c, opacity: 0.8 }} />
            ))}
          </div>
          <div className="absolute inset-0 flex">
            {months.map((m) => (
              <div key={m.key} className="flex-1 border-r border-white/50 last:border-r-0" />
            ))}
          </div>

          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {series.map(([key, pts]) => {
              if (pts.length < 2) return null;
              const cfg = markers[key] || markers.planned;
              const d = pts.map((p, i) => {
                const c = coords(p.date, p.score);
                return `${i ? 'L' : 'M'} ${c.x} ${c.y}`;
              });
              return (
                <path
                  key={key}
                  d={d.join(' ')}
                  fill="none"
                  stroke={cfg.stroke}
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={cfg.dashed ? '4 2' : undefined}
                  strokeLinejoin="round"
                />
              );
            })}
          </svg>

          {series.map(([key, pts]) => {
            const cfg = markers[key] || markers.planned;
            return pts.map((p, i) => {
              const c = coords(p.date, p.score);
              return (
                <div
                  key={`${key}-${i}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${c.x}%`, top: `${c.y}%` }}
                >
                  <Marker shape={cfg.shape} stroke={cfg.stroke} fill={cfg.fill} />
                </div>
              );
            });
          })}
        </div>
      </div>

      {/* X axis */}
      <div className="flex shrink-0 pl-[3.5mm]">
        {months.map((m, i) => (
          <div key={m.key} className="flex-1 text-center font-mono text-[6px] leading-tight text-slate-600">
            {i % labelEvery === 0 ? (
              <>
                {m.label}
                <br />
                <span className="text-slate-400">{m.year}</span>
              </>
            ) : (
              ' '
            )}
          </div>
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap gap-x-[2.5mm] gap-y-[0.5mm] text-[7px] text-slate-700">
        {series.map(([key]) => {
          const cfg = markers[key] || markers.planned;
          return (
            <span key={key} className={cn('inline-flex items-center gap-[0.8mm]')}>
              <Marker shape={cfg.shape} stroke={cfg.stroke} fill={cfg.fill} size={7} />
              {cfg.label}
            </span>
          );
        })}
      </div>
    </div>
  );
};

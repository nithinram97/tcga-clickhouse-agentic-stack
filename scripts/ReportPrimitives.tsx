import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../../../@/lib/utils';

/* ------------------------------------------------------------------ */
/* Report meta shared by every page                                    */
/* ------------------------------------------------------------------ */

export interface ReportMeta {
  title: string;
  subtitle: string;
  classification: string;
  footerText: string;
  footerDate: string;
}

/* ------------------------------------------------------------------ */
/* FitToBox: scales its content down (with reflow) until it fits.      */
/* Guarantees nothing is clipped and no scrollbars appear.             */
/* ------------------------------------------------------------------ */

interface FitToBoxProps {
  children: React.ReactNode;
  className?: string;
  /** Smallest allowed scale. Content that still overflows is pushed onto measured pages instead. */
  minScale?: number;
}

export const FitToBox: React.FC<FitToBoxProps> = ({ children, className, minScale = 0.4 }) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(-1);

  const fit = useCallback(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    // small slack so print rounding never clips the last line
    const availH = outer.clientHeight - 3;
    const availW = outer.clientWidth;
    if (availH <= 0 || !availW) return;

    inner.style.transform = '';
    const heightAt = (s: number) => {
      inner.style.width = `${availW / s}px`;
      return inner.offsetHeight;
    };

    let scale = 1;
    if (heightAt(1) > availH) {
      // g(s) = s * H(W / s) is monotonic in s -> binary search the largest scale that fits
      let lo = minScale;
      let hi = 1;
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        if (heightAt(mid) * mid <= availH) lo = mid;
        else hi = mid;
      }
      scale = lo;
      heightAt(scale);
    }

    inner.style.transform = scale < 1 ? `scale(${scale})` : '';
    lastHeight.current = inner.offsetHeight;
  }, [minScale]);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    fit();

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };

    const outerObserver = new ResizeObserver(schedule);
    outerObserver.observe(outer);

    // Content changes (data loading, images) -> refit. Ignore resizes we caused ourselves.
    const innerObserver = new ResizeObserver(() => {
      if (Math.abs(inner.offsetHeight - lastHeight.current) > 1) schedule();
    });
    innerObserver.observe(inner);

    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(inner, { childList: true, subtree: true, characterData: true });

    inner.querySelectorAll('img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', schedule, { once: true });
    });
    document.fonts?.ready.then(schedule).catch(() => undefined);

    return () => {
      cancelAnimationFrame(frame);
      outerObserver.disconnect();
      innerObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [fit]);

  return (
    <div ref={outerRef} className={cn('relative h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden', className)}>
      <div ref={innerRef} className="absolute left-0 top-0 origin-top-left">
        {children}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* ReportPage: one A4 landscape sheet                                  */
/* ------------------------------------------------------------------ */

interface ReportPageProps {
  meta: ReportMeta;
  heading?: React.ReactNode;
  headingRight?: React.ReactNode;
  children: React.ReactNode;
  /** Body is wrapped in FitToBox unless `fit` is false (the child then controls its own fit). */
  fit?: boolean;
  probe?: boolean;
  bodyRef?: React.Ref<HTMLDivElement>;
  className?: string;
}

export const ReportPage: React.FC<ReportPageProps> = ({
  meta,
  heading,
  headingRight,
  children,
  fit = true,
  probe = false,
  bodyRef,
  className,
}) => (
  <section className={cn('report-page', probe && 'report-page--probe', className)}>
    {/* Running header */}
    <div className="flex h-[7mm] shrink-0 items-center justify-between border-b border-[#00205B]/15 text-[9px]">
      <span className="truncate font-semibold uppercase tracking-wider text-[#00205B]">{meta.title}</span>
      <span className="shrink-0 font-bold uppercase tracking-wider text-[#C8102E]">{meta.classification}</span>
    </div>

    {heading && (
      <div className="flex shrink-0 items-end justify-between gap-4 pb-[2mm] pt-[3mm]">
        <h2 className="min-w-0 text-[15px] font-bold leading-tight text-[#00205B]">{heading}</h2>
        {headingRight && <div className="shrink-0">{headingRight}</div>}
      </div>
    )}

    <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
      {fit ? <FitToBox>{children}</FitToBox> : children}
    </div>

    {/* Running footer */}
    <div className="mt-[2mm] flex h-[6mm] shrink-0 items-center justify-between border-t border-slate-200 text-[8.5px] text-slate-500">
      <span className="truncate">{meta.footerText}</span>
      <span className="font-mono">{meta.footerDate}</span>
      <span className="report-page-number font-mono font-semibold text-[#00205B]">Page </span>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* PaginatedTable: measures real row heights and packs them onto pages */
/* ------------------------------------------------------------------ */

interface PaginatedTableProps<T> {
  rows: T[];
  maxRowsPerPage: number;
  thead: React.ReactNode;
  renderRow: (row: T, index: number) => React.ReactNode;
  renderPage: (args: {
    table: React.ReactNode;
    pageIndex: number;
    pageCount: number;
    probe: boolean;
    bodyRef?: React.Ref<HTMLDivElement>;
  }) => React.ReactNode;
  emptyState?: React.ReactNode;
}

const TABLE_CLASS = 'report-table w-full border-collapse text-[9.5px]';

export function PaginatedTable<T>({
  rows,
  maxRowsPerPage,
  thead,
  renderRow,
  renderPage,
  emptyState,
}: PaginatedTableProps<T>) {
  const probeBodyRef = useRef<HTMLDivElement>(null);
  const probeTableRef = useRef<HTMLTableElement>(null);
  const [breaks, setBreaks] = useState<number[]>([]);

  const measure = useCallback(() => {
    const body = probeBodyRef.current;
    const table = probeTableRef.current;
    if (!body || !table) return;

    const avail = body.clientHeight;
    if (!avail) return;

    const headH = table.tHead?.offsetHeight ?? 0;
    const rowEls = Array.from(table.tBodies[0]?.rows ?? []);
    const next: number[] = [0];
    let used = headH;
    let count = 0;

    rowEls.forEach((tr, i) => {
      const h = tr.offsetHeight;
      if (count > 0 && (count >= maxRowsPerPage || used + h > avail)) {
        next.push(i);
        used = headH;
        count = 0;
      }
      used += h;
      count += 1;
    });

    setBreaks((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
  }, [maxRowsPerPage]);

  useLayoutEffect(() => {
    measure();
    const body = probeBodyRef.current;
    if (!body) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(body);
    if (probeTableRef.current) observer.observe(probeTableRef.current);
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => observer.disconnect();
  }, [measure, rows]);

  if (rows.length === 0) {
    return <>{renderPage({ table: emptyState ?? null, pageIndex: 0, pageCount: 1, probe: false })}</>;
  }

  // Before first measurement fall back to fixed chunks
  const starts = breaks.length > 0 ? breaks : rows.map((_, i) => i).filter((i) => i % Math.max(1, maxRowsPerPage) === 0);
  const pages = starts.map((start, i) => rows.slice(start, starts[i + 1] ?? rows.length));

  return (
    <>
      {/* Invisible measuring copy (never printed) */}
      <div className="report-measure" aria-hidden>
        {renderPage({
          table: (
            <table ref={probeTableRef} className={TABLE_CLASS}>
              {thead}
              <tbody>{rows.map((r, i) => renderRow(r, i))}</tbody>
            </table>
          ),
          pageIndex: 0,
          pageCount: 1,
          probe: true,
          bodyRef: probeBodyRef,
        })}
      </div>

      {pages.map((pageRows, pageIndex) => (
        <React.Fragment key={pageIndex}>
          {renderPage({
            table: (
              <table className={TABLE_CLASS}>
                {thead}
                <tbody>{pageRows.map((r, i) => renderRow(r, starts[pageIndex] + i))}</tbody>
              </table>
            ),
            pageIndex,
            pageCount: pages.length,
            probe: false,
          })}
        </React.Fragment>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Small shared bits                                                   */
/* ------------------------------------------------------------------ */

export const EmptyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex h-full min-h-[20mm] items-center justify-center text-[10px] italic text-slate-400">
    {children}
  </div>
);

/** Weighted flex split used to reproduce OnePager resizable layouts statically. */
export const Split: React.FC<{
  dir: 'row' | 'col';
  sizes: number[];
  children: React.ReactNode[];
  className?: string;
}> = ({ dir, sizes, children, className }) => (
  <div className={cn('flex h-full w-full min-h-0 min-w-0 gap-[1.5mm]', dir === 'col' && 'flex-col', className)}>
    {children.map((child, i) => (
      <div key={i} className="flex min-h-0 min-w-0" style={{ flex: `${sizes[i] ?? 1} 1 0%` }}>
        {child}
      </div>
    ))}
  </div>
);

/** Bordered panel with a navy caption bar. */
export const Panel: React.FC<{ title?: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  title,
  children,
  className,
}) => (
  <div className={cn('flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[1mm] border border-slate-300 bg-white', className)}>
    {title && (
      <div className="shrink-0 bg-[#00205B] px-[2mm] py-[0.8mm] text-[8.5px] font-bold uppercase tracking-wider text-white">
        {title}
      </div>
    )}
    <div className="relative flex min-h-0 flex-1 flex-col p-[1.5mm]">{children}</div>
  </div>
);

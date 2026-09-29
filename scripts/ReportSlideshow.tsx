import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from 'lucide-react';
import { cn } from '../../../../@/lib/utils';

/* ------------------------------------------------------------------ */
/* useReportSlideshow                                                  */
/*                                                                     */
/* Reuses the already-rendered preview pages: the preview container   */
/* becomes a full-screen stage, only the active .report-page is shown */
/* and the whole print area is scaled to fit the screen. Page layout  */
/* (FitToBox, table pagination) is untouched because only a CSS       */
/* transform is applied.                                              */
/* ------------------------------------------------------------------ */

const PAGE_SELECTOR = ':scope > .report-page';
const CONTROLS_SPACE = 64; // px reserved at the bottom for the control bar
const EDGE_PADDING = 24;

export function useReportSlideshow() {
  const stageRef = useRef<HTMLElement>(null); // the preview <main>
  const areaRef = useRef<HTMLDivElement>(null); // .report-print-area

  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const getPages = useCallback(
    () => Array.from(areaRef.current?.querySelectorAll<HTMLElement>(PAGE_SELECTOR) ?? []),
    [],
  );

  /** Page currently nearest the top of the scrolled preview, so the show starts where the user is. */
  const findVisiblePage = useCallback(() => {
    const stage = stageRef.current;
    const pages = getPages();
    if (!stage || pages.length === 0) return 0;
    const top = stage.getBoundingClientRect().top;
    const i = pages.findIndex((p) => p.getBoundingClientRect().bottom > top + 80);
    return Math.max(0, i);
  }, [getPages]);

  const start = useCallback(() => {
    setIndex(findVisiblePage());
    setActive(true);
    const stage = stageRef.current;
    // Fullscreen may be blocked (e.g. iframe without allowfullscreen) -> fixed overlay still works.
    stage?.requestFullscreen?.().catch(() => undefined);
  }, [findVisiblePage]);

  const stop = useCallback(() => {
    setActive(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else stageRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const go = useCallback((delta: number) => {
    setIndex((i) => i + delta);
  }, []);
  const goTo = useCallback((i: number) => setIndex(i), []);

  /* Track fullscreen state; leaving browser fullscreen via Esc ends the show. */
  useEffect(() => {
    const onChange = () => {
      const fs = document.fullscreenElement === stageRef.current && Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /* Mark the active page, keep count in sync as pages (re)paginate. */
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!active || !area) return;

    const sync = () => {
      const pages = getPages();
      setCount(pages.length);
      const clamped = Math.min(Math.max(index, 0), Math.max(pages.length - 1, 0));
      if (clamped !== index) setIndex(clamped);
      pages.forEach((p, i) => p.toggleAttribute('data-slide-active', i === clamped));
    };
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(area, { childList: true });
    return () => {
      observer.disconnect();
      getPages().forEach((p) => p.removeAttribute('data-slide-active'));
    };
  }, [active, index, getPages]);

  /* Scale the A4 page to the screen. */
  useLayoutEffect(() => {
    if (!active) return;
    const fit = () => {
      const page = getPages()[0];
      const stage = stageRef.current;
      if (!page || !stage) return;
      const w = stage.clientWidth - EDGE_PADDING * 2;
      const h = stage.clientHeight - CONTROLS_SPACE - EDGE_PADDING;
      setScale(Math.max(0.1, Math.min(w / page.offsetWidth, h / page.offsetHeight)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [active, isFullscreen, getPages]);

  /* Keyboard control. */
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
          e.preventDefault();
          go(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          e.preventDefault();
          go(-1);
          break;
        case 'Home':
          e.preventDefault();
          goTo(0);
          break;
        case 'End':
          e.preventDefault();
          goTo(Number.MAX_SAFE_INTEGER);
          break;
        case 'Escape':
          stop();
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, go, goTo, stop, toggleFullscreen]);

  /* If the user leaves fullscreen with Esc, the keydown never reaches us -> end the show too. */
  const wasFullscreen = useRef(false);
  useEffect(() => {
    if (!active) {
      wasFullscreen.current = false;
      return;
    }
    if (isFullscreen) wasFullscreen.current = true;
    else if (wasFullscreen.current) {
      wasFullscreen.current = false;
      setActive(false);
    }
  }, [active, isFullscreen]);

  return {
    stageRef,
    areaRef,
    active,
    index: Math.min(index, Math.max(count - 1, 0)),
    count,
    scale,
    isFullscreen,
    start,
    stop,
    go,
    goTo,
    toggleFullscreen,
  };
}

export type ReportSlideshow = ReturnType<typeof useReportSlideshow>;

/* ------------------------------------------------------------------ */
/* Controls overlay                                                    */
/* ------------------------------------------------------------------ */

export const SlideshowControls: React.FC<{ show: ReportSlideshow; title: string }> = ({ show, title }) => {
  const [visible, setVisible] = useState(true);
  const timer = useRef<number>();

  // Auto-hide controls while presenting; any mouse movement brings them back.
  useEffect(() => {
    const wake = () => {
      setVisible(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setVisible(false), 2500);
    };
    wake();
    window.addEventListener('mousemove', wake);
    return () => {
      window.removeEventListener('mousemove', wake);
      window.clearTimeout(timer.current);
    };
  }, []);

  const atStart = show.index <= 0;
  const atEnd = show.index >= show.count - 1;

  return (
    <>
      {/* Click zones: left third = previous, right two thirds = next */}
      <button
        type="button"
        aria-label="Previous page"
        onClick={() => show.go(-1)}
        className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-w-resize bg-transparent"
      />
      <button
        type="button"
        aria-label="Next page"
        onClick={() => show.go(1)}
        className="absolute inset-y-0 right-0 z-10 w-2/3 cursor-e-resize bg-transparent"
      />

      <div
        className={cn(
          'absolute inset-x-0 bottom-0 z-20 flex h-14 items-center justify-between gap-4 bg-gradient-to-t from-black/70 to-transparent px-5 text-white transition-opacity duration-300',
          visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/70">{title}</span>

        <div className="flex items-center gap-1 rounded-full bg-white/10 px-1 py-1 backdrop-blur">
          <CtrlBtn label="Previous (←)" disabled={atStart} onClick={() => show.go(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </CtrlBtn>
          <span className="min-w-[64px] text-center font-mono text-xs tabular-nums">
            {show.count ? show.index + 1 : 0} / {show.count}
          </span>
          <CtrlBtn label="Next (→)" disabled={atEnd} onClick={() => show.go(1)}>
            <ChevronRight className="h-4 w-4" />
          </CtrlBtn>
        </div>

        <div className="flex flex-1 items-center justify-end gap-1">
          <CtrlBtn label={show.isFullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} onClick={show.toggleFullscreen}>
            {show.isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </CtrlBtn>
          <CtrlBtn label="Exit slideshow (Esc)" onClick={show.stop}>
            <X className="h-4 w-4" />
          </CtrlBtn>
        </div>
      </div>

      {/* Thin progress bar */}
      <div className="absolute inset-x-0 top-0 z-20 h-[3px] bg-white/10">
        <div
          className="h-full bg-[#DA1884] transition-[width] duration-200"
          style={{ width: show.count ? `${((show.index + 1) / show.count) * 100}%` : '0%' }}
        />
      </div>
    </>
  );
};

const CtrlBtn: React.FC<{ label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({
  label,
  onClick,
  disabled,
  children,
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    disabled={disabled}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 disabled:cursor-default disabled:opacity-30"
  >
    {children}
  </button>
);

/* ------------------------------------------------------------------ */
/* Styles (appended to the report stylesheet)                          */
/* ------------------------------------------------------------------ */

export const SLIDESHOW_CSS = `
.report-preview.report-slideshow {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 !important;
  overflow: hidden !important;
  background: #0b1220;
}
.report-slideshow .report-slideshow-hide { display: none !important; }
.report-slideshow .report-print-area {
  position: relative;
  display: block;
  width: 297mm !important;
  height: 210mm;
  flex-shrink: 0;
  margin: 0 !important;
  transform: translateY(-${CONTROLS_SPACE / 2 - EDGE_PADDING / 2}px) scale(var(--slide-scale, 1));
  transform-origin: center center;
}
.report-slideshow .report-print-area > .report-page {
  position: absolute;
  inset: 0;
  visibility: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.report-slideshow .report-print-area > .report-page[data-slide-active] { visibility: visible; }
`;

import { useCallback, useEffect, useRef, useState } from 'react';
import { marketClient } from '@/state/marketClient';
import { useUi } from '@/state/store';
import { themeByName } from './theme';
import { Viewport, clamp, MAX_BAR_SPACING, MIN_BAR_SPACING } from './viewport';
import { PRICE_AXIS_WIDTH, TIME_AXIS_HEIGHT, render, type CrosshairState } from './renderer';
import { ChartLegend } from '@/ui/ChartLegend';
import { ScrollToRealtime } from '@/ui/ScrollToRealtime';

/**
 * Empty space kept to the right of the newest candle, in pixels.
 *
 * Measuring the margin in pixels rather than bars keeps the gap visually
 * constant while zooming, which is what a charting terminal does.
 */
const DEFAULT_RIGHT_MARGIN_PX = 90;
const DEFAULT_VISIBLE_BARS = 160;

type DragMode = 'none' | 'pan' | 'priceScale' | 'timeScale';

export function ChartCanvas(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(new Viewport());
  const crosshairRef = useRef<CrosshairState>({ x: 0, y: 0, visible: false });
  const followRef = useRef(true);
  const rightMarginRef = useRef(DEFAULT_RIGHT_MARGIN_PX);
  const revisionRef = useRef(-1);
  const dragRef = useRef<{ mode: DragMode; x: number; y: number; moved: boolean }>({
    mode: 'none',
    x: 0,
    y: 0,
    moved: false,
  });
  const pinchRef = useRef<{ distance: number; centerX: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());

  const [atRealtime, setAtRealtime] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const theme = useUi((s) => s.theme);
  const timeframe = useUi((s) => s.timeframe);
  const timeZone = useUi((s) => s.timeZone);
  const autoScale = useUi((s) => s.autoScale);
  const logScale = useUi((s) => s.logScale);
  const showVolume = useUi((s) => s.showVolume);
  const cursorMode = useUi((s) => s.cursorMode);

  // Keep the viewport's scale flags in sync with the UI toggles.
  useEffect(() => {
    vpRef.current.autoScale = autoScale;
  }, [autoScale]);
  useEffect(() => {
    vpRef.current.logScale = logScale;
  }, [logScale]);

  const resetView = useCallback(() => {
    const vp = vpRef.current;
    const len = marketClient.series.length;
    vp.barSpacing = clamp(vp.width / DEFAULT_VISIBLE_BARS, MIN_BAR_SPACING, MAX_BAR_SPACING);
    rightMarginRef.current = DEFAULT_RIGHT_MARGIN_PX;
    vp.rightIndex = Math.max(0, len - 1) + rightMarginRef.current / vp.barSpacing;
    followRef.current = true;
    setAtRealtime(true);
  }, []);

  // --- render loop -------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const dpr = window.devicePixelRatio || 1;
      const cssWidth = container.clientWidth;
      const cssHeight = container.clientHeight;
      if (cssWidth === 0 || cssHeight === 0) return;

      const needW = Math.round(cssWidth * dpr);
      const needH = Math.round(cssHeight * dpr);
      if (canvas.width !== needW || canvas.height !== needH) {
        canvas.width = needW;
        canvas.height = needH;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
      }

      const vp = vpRef.current;
      const firstLayout = vp.width === 0;
      vp.width = cssWidth - PRICE_AXIS_WIDTH;
      vp.height = cssHeight - TIME_AXIS_HEIGHT;

      const series = marketClient.series;
      if (revisionRef.current !== marketClient.revision || firstLayout) {
        revisionRef.current = marketClient.revision;
        if (series.length > 0) resetView();
      }

      if (followRef.current && series.length > 0) {
        vp.rightIndex = series.length - 1 + rightMarginRef.current / vp.barSpacing;
      }
      vp.clampScroll(series.length);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx, {
        series,
        viewport: vp,
        theme: themeByName(theme),
        timeframe,
        timeZone,
        crosshair: crosshairRef.current,
        volumeHeightRatio: 0.18,
        showVolume,
        lastPriceCents: marketClient.quote.last || series.lastClose(),
        now: Date.now(),
        dpr,
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [theme, timeframe, timeZone, showVolume, resetView]);

  // --- pointer interaction ----------------------------------------------
  const zoneOf = useCallback((x: number, y: number): DragMode => {
    const vp = vpRef.current;
    if (x > vp.width) return 'priceScale';
    if (y > vp.height) return 'timeScale';
    return 'pan';
  }, []);

  const syncFollow = useCallback(() => {
    const vp = vpRef.current;
    const len = marketClient.series.length;
    if (len === 0) return;
    vp.clampScroll(len);
    const marginPx = (vp.rightIndex - (len - 1)) * vp.barSpacing;
    // Half a candle of slack: the newest bar can sit right on the edge.
    const following = marginPx >= -vp.barSpacing * 0.5;
    followRef.current = following;
    if (following) {
      rightMarginRef.current = clamp(marginPx, 0, vp.maxRightMarginPx());
    }
    setAtRealtime((prev) => (prev === following ? prev : following));
  }, []);

  /**
   * Zoom the time axis.
   *
   * While the chart is pinned to the live edge, zooming keeps the newest
   * candle at the same pixel and only changes the bar width — anchoring on the
   * cursor there would slide the live candle off into blank space.
   */
  const zoom = useCallback((x: number, factor: number) => {
    const vp = vpRef.current;
    if (followRef.current) vp.setBarSpacing(vp.barSpacing * factor);
    else vp.zoomAt(x, factor);
    syncFollow();
  }, [syncFollow]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      pointersRef.current.set(e.pointerId, { x, y });
      if (pointersRef.current.size === 2) {
        const pts = [...pointersRef.current.values()];
        const a = pts[0]!;
        const b = pts[1]!;
        pinchRef.current = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          centerX: (a.x + b.x) / 2,
        };
        dragRef.current.mode = 'none';
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { mode: zoneOf(x, y), x, y, moved: false };
    },
    [zoneOf],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const vp = vpRef.current;

    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x, y });

    if (pointersRef.current.size === 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const factor = dist / (pinchRef.current.distance || dist);
      zoom(pinchRef.current.centerX, factor);
      pinchRef.current.distance = dist;
      return;
    }

    crosshairRef.current = { x, y, visible: x <= vp.width && y <= vp.height };
    const idx = Math.round(vp.indexOfX(x));
    setHoverIndex(x <= vp.width && y <= vp.height && idx >= 0 && idx < marketClient.series.length ? idx : null);

    const drag = dragRef.current;
    if (drag.mode === 'none') return;
    const dx = x - drag.x;
    const dy = y - drag.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) drag.moved = true;

    if (drag.mode === 'pan') {
      vp.rightIndex -= dx / vp.barSpacing;
      if (!vp.autoScale) vp.panRange(dy);
      syncFollow();
    } else if (drag.mode === 'priceScale') {
      // Dragging down compresses the price axis, like a pro terminal.
      const factor = Math.exp(dy / 160);
      if (vp.autoScale) {
        // Leaving auto-scale on would immediately undo the drag.
        useUi.getState().toggleAutoScale();
        vp.autoScale = false;
      }
      vp.scaleRange(factor);
    } else if (drag.mode === 'timeScale') {
      zoom(vp.width, Math.exp(-dx / 160));
    }
    drag.x = x;
    drag.y = y;
  }, [zoom, syncFollow]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    dragRef.current.mode = 'none';
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }, []);

  const onPointerLeave = useCallback(() => {
    crosshairRef.current = { ...crosshairRef.current, visible: false };
    setHoverIndex(null);
  }, []);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const vp = vpRef.current;
      if (x > vp.width) {
        // Double-click the price axis: back to auto-scale.
        if (!useUi.getState().autoScale) useUi.getState().toggleAutoScale();
        vp.autoScale = true;
      } else if (y > vp.height) {
        resetView();
      } else {
        resetView();
      }
    },
    [resetView],
  );

  // Wheel handling is registered manually so it can be non-passive and
  // preventDefault the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const vp = vpRef.current;
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        // Trackpad pinch arrives as ctrl+wheel; plain wheel zooms too.
        zoom(Math.min(x, vp.width), Math.exp(-e.deltaY * 0.0022));
      } else {
        vp.rightIndex += e.deltaX / vp.barSpacing;
        syncFollow();
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom, syncFollow]);

  const goRealtime = useCallback(() => {
    rightMarginRef.current = DEFAULT_RIGHT_MARGIN_PX;
    followRef.current = true;
    setAtRealtime(true);
  }, []);

  const cursorCss = cursorMode === 'arrow' ? 'default' : cursorMode === 'dot' ? 'cell' : 'crosshair';

  return (
    <div className="chart-container" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="chart-canvas"
        style={{ cursor: cursorCss }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
      />
      <ChartLegend hoverIndex={hoverIndex} />
      {!atRealtime && <ScrollToRealtime onClick={goRealtime} />}
    </div>
  );
}

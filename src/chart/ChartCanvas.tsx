import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marketClient } from '@/state/marketClient';
import { useUi, type DateRange } from '@/state/store';
import { themeByName } from './theme';
import { PriceScale, TimeScale, clamp, MAX_BAR_SPACING, MIN_BAR_SPACING } from './scales';
import {
  drawLastPriceTagOnTop,
  PRICE_AXIS_WIDTH,
  render,
  TIME_AXIS_HEIGHT,
  type CrosshairState,
} from './renderer';
import { HeikinAshiCache } from './plotSeries';
import { chartController } from './chartController';
import {
  PANE_SEPARATOR,
  layoutPanes,
  resizePane,
  syncPriceScales,
  type Pane,
  type PaneItem,
} from './panes';
import { indicatorDef } from '@/indicators/defs';
import { indicatorEngine } from '@/indicators/engine';
import { TF_SECONDS } from '@/engine/timeframes';
import { DrawingMap, magnetPrice } from '@/drawings/mapping';
import { resolveShape, hitTestShape, type Bounds } from '@/drawings/geometry';
import { drawDrawings } from '@/drawings/render';
import {
  dragPoints,
  isMeaningful,
  isSingleClick,
  makeDrawing,
  moveHandle,
  offsetPoints,
  startPoints,
  translate,
  type Placement,
} from '@/drawings/placement';
import type { Drawing, DrawingPoint } from '@/drawings/types';
import { useDrawings } from '@/state/drawingsStore';
import { chartMapping } from './chartMapping';
import { drawExecutionMarkers, drawTradingLines } from './tradingLayer';
import { alertChartLines, chartLines } from '@/trading/chartLines';
import { useAlerts } from '@/state/alertsStore';
import { accountMetrics } from '@/trading/metrics';
import { useTrading } from '@/state/tradingStore';
import { currentQuote } from '@/ui/useQuote';
import { OrderLineControls } from '@/ui/OrderLineControls';
import { DrawingContextMenu } from '@/ui/DrawingContextMenu';
import { TextLabelEditor } from '@/ui/TextLabelEditor';
import { ChartLegend } from '@/ui/ChartLegend';
import { PaneLegends, type PaneLegendRow } from '@/ui/PaneLegends';
import { QuickTrade } from '@/ui/QuickTrade';
import { ScrollToRealtime } from '@/ui/ScrollToRealtime';

/**
 * Empty space kept to the right of the newest candle, in pixels.
 *
 * Measuring the margin in pixels rather than bars keeps the gap visually
 * constant while zooming, which is what a charting terminal does.
 */
const DEFAULT_RIGHT_MARGIN_PX = 90;
const DEFAULT_VISIBLE_BARS = 160;

/** How much of a price move is closed each frame by the easing. */
const PRICE_EASING = 0.22;
/** Beyond this relative jump, snap instead of easing — it is a new series. */
const EASING_SNAP_THRESHOLD = 0.02;

const DAY_MS = 86_400_000;
const RANGE_MS: Record<DateRange, number> = {
  '1D': DAY_MS,
  '5D': 5 * DAY_MS,
  '1M': 30 * DAY_MS,
  All: Number.POSITIVE_INFINITY,
};

/**
 * Move `current` a fraction of the way toward `target`.
 *
 * A large jump means the underlying series changed (a new timeframe, a new
 * chart type, a fresh reload) rather than the market moving, so it snaps
 * instead of sliding across the screen.
 */
function ease(current: number, target: number): number {
  if (!Number.isFinite(target)) return current;
  if (!Number.isFinite(current)) return target;
  if (Math.abs(target - current) > Math.abs(target) * EASING_SNAP_THRESHOLD) return target;
  return current + (target - current) * PRICE_EASING;
}

type DragMode = 'none' | 'pan' | 'valueScale' | 'timeScale' | 'paneResize';

interface PaneRect {
  id: string;
  top: number;
  height: number;
}

export function ChartCanvas(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeScaleRef = useRef(new TimeScale());
  const priceScalesRef = useRef(new Map<string, PriceScale>());
  const crosshairRef = useRef<CrosshairState>({ x: 0, y: 0, visible: false });
  const followRef = useRef(true);
  const rightMarginRef = useRef(DEFAULT_RIGHT_MARGIN_PX);
  const revisionRef = useRef(-1);
  const dragRef = useRef<{ mode: DragMode; x: number; y: number; paneId: string; index: number }>({
    mode: 'none',
    x: 0,
    y: 0,
    paneId: 'main',
    index: 0,
  });
  const pinchRef = useRef<{ distance: number; centerX: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const heikinRef = useRef(new HeikinAshiCache());
  /** Eased last price, so the price line and tag glide between ticks. */
  const smoothPriceRef = useRef(Number.NaN);
  /** Eased close of the newest candle, in the plotted series' own units. */
  const smoothCloseRef = useRef(Number.NaN);
  /** Pane rectangles from the last frame, for hit testing between frames. */
  const rectsRef = useRef<PaneRect[]>([]);
  const plotBottomRef = useRef(0);

  const [atRealtime, setAtRealtime] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [paneRects, setPaneRects] = useState<PaneRect[]>([]);
  const [cursorOverride, setCursorOverride] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [textEdit, setTextEdit] = useState<{ x: number; y: number; id: string } | null>(null);

  /** Rebuilt every frame so the pointer handlers share the renderer's mapping. */
  const mapRef = useRef<DrawingMap | null>(null);
  const boundsRef = useRef<Bounds>({ width: 0, top: 0, height: 0 });
  const placeRef = useRef<Placement>({ kind: 'idle' });
  const drawDragRef = useRef<{ id: string; handle: number; from: DrawingPoint } | null>(null);
  /**
   * A text label waiting for its editor.
   *
   * The editor cannot be opened during pointerdown: the browser's own handling
   * of that event moves focus away from whatever was just mounted, which
   * blurred the input and discarded the label before it could be typed into.
   * Opening it on pointerup sidesteps that entirely.
   */
  const pendingTextRef = useRef<{ id: string; x: number; y: number } | null>(null);
  /** The order line being dragged to a new price, if any. */
  const lineDragRef = useRef<{ orderId?: string; alertId?: string } | null>(null);

  const theme = useUi((s) => s.theme);
  const timeframe = useUi((s) => s.timeframe);
  const timeZone = useUi((s) => s.timeZone);
  const autoScale = useUi((s) => s.autoScale);
  const logScale = useUi((s) => s.logScale);
  const showVolume = useUi((s) => s.showVolume);
  const cursorMode = useUi((s) => s.cursorMode);
  const chartType = useUi((s) => s.chartType);
  const indicators = useUi((s) => s.indicators);
  // The render loop and the pointer handlers read the drawings store directly;
  // only the cursor shape needs the component to re-render when it changes.
  const drawingTool = useDrawings((s) => s.tool);

  /** Indicators that get their own pane, in order; the rest overlay the price. */
  const paneIndicators = useMemo(
    () => indicators.filter((i) => indicatorDef(i.defId)?.overlay === false),
    [indicators],
  );
  const overlayIndicators = useMemo(
    () => indicators.filter((i) => indicatorDef(i.defId)?.overlay !== false),
    [indicators],
  );
  const paneIds = useMemo(
    () => ['main', ...paneIndicators.map((i) => i.id)],
    [paneIndicators],
  );

  // The main pane's scale flags follow the toolbar toggles; indicator panes
  // always auto-scale, since a manual range on an RSI is rarely useful.
  useEffect(() => {
    const ps = priceScalesRef.current.get('main');
    if (ps) ps.autoScale = autoScale;
  }, [autoScale]);
  useEffect(() => {
    const ps = priceScalesRef.current.get('main');
    if (ps) ps.logScale = logScale;
  }, [logScale]);

  const resetView = useCallback(() => {
    const ts = timeScaleRef.current;
    const len = marketClient.series.length;
    ts.barSpacing = clamp(ts.width / DEFAULT_VISIBLE_BARS, MIN_BAR_SPACING, MAX_BAR_SPACING);
    rightMarginRef.current = DEFAULT_RIGHT_MARGIN_PX;
    ts.rightIndex = Math.max(0, len - 1) + rightMarginRef.current / ts.barSpacing;
    followRef.current = true;
    setAtRealtime(true);
    useUi.getState().setActiveRange(null);
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

      const ts = timeScaleRef.current;
      const firstLayout = ts.width === 0;
      ts.width = cssWidth - PRICE_AXIS_WIDTH;
      const plotHeight = cssHeight - TIME_AXIS_HEIGHT;
      plotBottomRef.current = plotHeight;

      const series = marketClient.series;
      if (revisionRef.current !== marketClient.revision || firstLayout) {
        revisionRef.current = marketClient.revision;
        if (series.length > 0) resetView();
      }

      if (followRef.current && series.length > 0) {
        ts.rightIndex = series.length - 1 + rightMarginRef.current / ts.barSpacing;
      }
      ts.clampScroll(series.length);

      // --- panes ---------------------------------------------------------
      const ui = useUi.getState();
      const scales = syncPriceScales(paneIds, priceScalesRef.current);
      const rects = layoutPanes(paneIds, ui.paneRatios, plotHeight);
      rectsRef.current = rects;
      for (const r of rects) {
        const ps = scales.get(r.id);
        if (!ps) continue;
        ps.top = r.top;
        ps.height = r.height;
      }
      if (rectsChanged(paneRects, rects)) setPaneRects(rects);

      const panes: Pane[] = [];
      const mainScale = scales.get('main') as PriceScale;
      panes.push({
        id: 'main',
        kind: 'main',
        priceScale: mainScale,
        items: buildItems(overlayIndicators, series),
        format: 'price',
        guides: [],
      });
      for (const inst of paneIndicators) {
        const def = indicatorDef(inst.defId);
        const ps = scales.get(inst.id);
        if (!def || !ps) continue;
        ps.autoScale = true;
        ps.fixedRange = def.fixedRange ?? null;
        ps.paddingTop = def.fixedRange ? 0.02 : 0.1;
        ps.paddingBottom = def.fixedRange ? 0.02 : 0.1;
        panes.push({
          id: inst.id,
          kind: 'indicator',
          priceScale: ps,
          items: buildItems([inst], series),
          format: def.format,
          guides: def.guides ?? [],
        });
      }
      indicatorEngine.prune(indicators.map((i) => i.id));

      const plot = chartType === 'heikin' ? heikinRef.current.sync(series) : series;

      // Ease the displayed price toward the real one. The candles always show
      // the truth; only the price line, its tag and the live candle's closing
      // edge are smoothed, so the chart never lies about a value while still
      // feeling fluid.
      const target = marketClient.quote.last || series.lastClose();
      smoothPriceRef.current = ease(smoothPriceRef.current, target);
      const plotClose = plot.length > 0 ? (plot.close[plot.length - 1] as number) : Number.NaN;
      smoothCloseRef.current = ease(smoothCloseRef.current, plotClose);

      const tfMs = TF_SECONDS[timeframe] * 1000;
      mapRef.current = new DrawingMap(series, tfMs, ts, mainScale);
      boundsRef.current = { width: ts.width, top: mainScale.top, height: mainScale.height };
      chartMapping.map = mapRef.current;
      chartMapping.bounds = boundsRef.current;
      chartMapping.axisWidth = PRICE_AXIS_WIDTH;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const renderInput = {
        series,
        plot,
        chartType,
        timeScale: ts,
        panes,
        theme: themeByName(theme),
        timeframe,
        timeZone,
        crosshair: crosshairRef.current,
        showCrosshairLines: cursorMode !== 'dot',
        volumeHeightRatio: 0.16,
        showVolume,
        lastPriceCents: target,
        smoothPriceCents: smoothPriceRef.current,
        liveClose: Number.isFinite(smoothCloseRef.current) ? smoothCloseRef.current : null,
        now: Date.now(),
        dpr,
      };
      const lastPriceTag = render(ctx, renderInput);

      const place = placeRef.current;
      const dw = useDrawings.getState();
      drawDrawings(ctx, {
        drawings: dw.drawings,
        // The in-progress drawing is rendered from the same code path as a
        // committed one, so what you see while dragging is what you get.
        preview: place.kind === 'idle' ? null : makeDrawing(place.tool, place.points, dw.style),
        map: mapRef.current,
        bounds: boundsRef.current,
        theme: themeByName(theme),
        dpr,
        selectedId: dw.selectedId,
        hidden: dw.hidden,
      });

      // The account's lines and fill markers go on top of the drawings, so an
      // order line is never hidden behind a rectangle.
      const trading = useTrading.getState();
      const account = trading.active();
      const quote = currentQuote();
      if (quote.lastCents > 0) {
        const layer = {
          lines: [
            ...chartLines(account, accountMetrics(account, quote)),
            ...alertChartLines(useAlerts.getState().alerts),
          ],
          executions: account.executions,
          series,
          map: mapRef.current,
          timeScale: ts,
          priceScale: mainScale,
          theme: themeByName(theme),
          dpr,
          controlsWidth: 96,
        };
        drawExecutionMarkers(ctx, layer);
        drawTradingLines(ctx, layer);
      }

      // Last of all, so an order or alert line dropped near the market never
      // hides the market price itself.
      drawLastPriceTagOnTop(ctx, renderInput, lastPriceTag);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [
    theme,
    timeframe,
    timeZone,
    showVolume,
    chartType,
    cursorMode,
    resetView,
    paneIds,
    paneIndicators,
    overlayIndicators,
    indicators,
    paneRects,
  ]);

  // --- interaction -------------------------------------------------------

  // --- drawings ----------------------------------------------------------

  /** Pointer position as a timestamp and price, snapped if magnet is on. */
  const dataPointAt = useCallback((x: number, y: number): DrawingPoint | null => {
    const map = mapRef.current;
    if (!map) return null;
    const time = map.snapTime(map.timeOfX(x));
    const raw = map.priceOfY(y);
    const dw = useDrawings.getState();
    const price = dw.magnet ? magnetPrice(marketClient.series, map, time, raw) : raw;
    return { time, price };
  }, []);

  /** Topmost drawing under the pointer, and which of its handles was grabbed. */
  const drawingAt = useCallback(
    (x: number, y: number): { drawing: Drawing; handle: number } | null => {
      const map = mapRef.current;
      if (!map) return null;
      const dw = useDrawings.getState();
      if (dw.hidden || dw.locked) return null;
      // Last drawn is on top, so search backwards.
      for (let i = dw.drawings.length - 1; i >= 0; i--) {
        const d = dw.drawings[i] as Drawing;
        if (!d.visible || d.locked) continue;
        const hit = hitTestShape(resolveShape(d, map, boundsRef.current), x, y);
        if (hit) return { drawing: d, handle: hit.handle };
      }
      return null;
    },
    [],
  );

  /**
   * The working-order line under the pointer, if any.
   *
   * Only orders are draggable: the position's entry and its liquidation price
   * are consequences of the position, not things the user can move.
   */
  const orderLineAt = useCallback(
    (x: number, y: number): { orderId?: string; alertId?: string } | null => {
      const map = mapRef.current;
      if (!map || x > timeScaleRef.current.width) return null;
      const account = useTrading.getState().active();
      const quote = currentQuote();
      if (quote.lastCents <= 0) return null;
      const lines = [
        ...chartLines(account, accountMetrics(account, quote)),
        ...alertChartLines(useAlerts.getState().alerts),
      ];
      for (const line of lines) {
        if (!line.draggable) continue;
        if (Math.abs(map.yOfPrice(line.priceCents) - y) > 5) continue;
        if (line.orderId) return { orderId: line.orderId };
        if (line.alertId) return { alertId: line.alertId };
      }
      return null;
    },
    [],
  );

  const cancelPlacement = useCallback(() => {
    placeRef.current = { kind: 'idle' };
  }, []);

  /** Finish the drawing being placed; returns the committed drawing, if any. */
  const commitPlacement = useCallback((): Drawing | null => {
    const place = placeRef.current;
    if (place.kind === 'idle') return null;
    placeRef.current = { kind: 'idle' };
    const dw = useDrawings.getState();
    const map = mapRef.current;
    // One bar of movement is the smallest gesture we treat as deliberate.
    const minSpan = map ? Math.abs(map.timeOfIndex(1) - map.timeOfIndex(0)) : 0;
    if (!isMeaningful(place.tool, place.points, minSpan)) return null;
    const drawing = makeDrawing(place.tool, place.points, dw.style, place.tool === 'text' ? '' : undefined);
    dw.add(drawing);
    dw.setTool('cursor');
    return drawing;
  }, []);


  const syncFollow = useCallback(() => {
    const ts = timeScaleRef.current;
    const len = marketClient.series.length;
    if (len === 0) return;
    ts.clampScroll(len);
    const marginPx = (ts.rightIndex - (len - 1)) * ts.barSpacing;
    // Half a candle of slack: the newest bar can sit right on the edge.
    const following = marginPx >= -ts.barSpacing * 0.5;
    followRef.current = following;
    if (following) {
      rightMarginRef.current = clamp(marginPx, 0, ts.maxRightMarginPx());
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
  const zoom = useCallback(
    (x: number, factor: number) => {
      const ts = timeScaleRef.current;
      if (followRef.current) ts.setBarSpacing(ts.barSpacing * factor);
      else ts.zoomAt(x, factor);
      useUi.getState().setActiveRange(null);
      syncFollow();
    },
    [syncFollow],
  );

  /** Which part of the chart is under a point, and which pane it belongs to. */
  const hitTest = useCallback((x: number, y: number): { mode: DragMode; paneId: string; index: number } => {
    const ts = timeScaleRef.current;
    const rects = rectsRef.current;
    // Separators first: they overlap the edges of the panes on either side.
    for (let i = 0; i < rects.length - 1; i++) {
      const r = rects[i] as PaneRect;
      const gapTop = r.top + r.height;
      if (y >= gapTop - 2 && y <= gapTop + PANE_SEPARATOR + 2) {
        return { mode: 'paneResize', paneId: r.id, index: i };
      }
    }
    const pane = rects.find((r) => y >= r.top && y <= r.top + r.height);
    if (x > ts.width) return { mode: 'valueScale', paneId: pane?.id ?? 'main', index: 0 };
    if (y > plotBottomRef.current) return { mode: 'timeScale', paneId: 'main', index: 0 };
    return { mode: 'pan', paneId: pane?.id ?? 'main', index: 0 };
  }, []);

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

      const inPlot = x <= timeScaleRef.current.width && boundsRef.current.height > 0;
      const insidePricePane =
        inPlot && y >= boundsRef.current.top && y <= boundsRef.current.top + boundsRef.current.height;

      if (insidePricePane && e.button === 0) {
        const dw = useDrawings.getState();
        const place = placeRef.current;

        // Second stage of the parallel channel: this click fixes the offset.
        if (place.kind === 'awaitingOffset') {
          commitPlacement();
          return;
        }

        if (dw.tool !== 'cursor') {
          const at = dataPointAt(x, y);
          if (!at) return;
          const points = startPoints(dw.tool, at);
          if (isSingleClick(dw.tool)) {
            placeRef.current = { kind: 'dragging', tool: dw.tool, points };
            const created = commitPlacement();
            // A text label is useless until it says something, so ask as soon
            // as the click finishes.
            if (created && created.tool === 'text') pendingTextRef.current = { id: created.id, x, y };
            return;
          }
          placeRef.current = { kind: 'dragging', tool: dw.tool, points };
          return;
        }

        const lineHit = orderLineAt(x, y);
        if (lineHit) {
          lineDragRef.current = lineHit;
          return;
        }

        const hitDrawing = drawingAt(x, y);
        if (hitDrawing) {
          dw.select(hitDrawing.drawing.id);
          const at = dataPointAt(x, y);
          if (at) drawDragRef.current = { id: hitDrawing.drawing.id, handle: hitDrawing.handle, from: at };
          return;
        }
        if (dw.selectedId) dw.select(null);
      }

      const hit = hitTest(x, y);
      dragRef.current = { mode: hit.mode, x, y, paneId: hit.paneId, index: hit.index };
    },
    [hitTest, dataPointAt, drawingAt, commitPlacement, orderLineAt],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const ts = timeScaleRef.current;

      if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x, y });

      if (pointersRef.current.size === 2 && pinchRef.current) {
        const pts = [...pointersRef.current.values()];
        const a = pts[0]!;
        const b = pts[1]!;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        zoom(pinchRef.current.centerX, dist / (pinchRef.current.distance || dist));
        pinchRef.current.distance = dist;
        return;
      }

      const place = placeRef.current;
      if (place.kind !== 'idle') {
        const at = dataPointAt(x, y);
        if (at) {
          placeRef.current =
            place.kind === 'awaitingOffset'
              ? { kind: 'awaitingOffset', tool: 'channel', points: offsetPoints(place.points, at) }
              : { kind: 'dragging', tool: place.tool, points: dragPoints(place.tool, place.points, at) };
        }
      }

      const lineDrag = lineDragRef.current;
      if (lineDrag) {
        const map = mapRef.current;
        if (map) {
          const price = Math.round(map.priceOfY(y));
          if (price > 0) {
            if (lineDrag.orderId) useTrading.getState().moveOrder(lineDrag.orderId, price);
            else if (lineDrag.alertId) useAlerts.getState().setPrice(lineDrag.alertId, price);
          }
        }
        crosshairRef.current = { x, y, visible: true };
        return;
      }

      const drawDrag = drawDragRef.current;
      if (drawDrag) {
        const at = dataPointAt(x, y);
        const dw = useDrawings.getState();
        const drawing = dw.drawings.find((d) => d.id === drawDrag.id);
        if (at && drawing) {
          const next =
            drawDrag.handle < 0
              ? translate(drawing.points, at.time - drawDrag.from.time, at.price - drawDrag.from.price)
              : moveHandle(drawing.tool, drawing.points, drawDrag.handle, at);
          if (drawDrag.handle < 0) drawDragRef.current = { ...drawDrag, from: at };
          dw.moveLive(drawDrag.id, next);
        }
      }

      crosshairRef.current = { x, y, visible: x <= ts.width && y <= plotBottomRef.current };
      const idx = Math.round(ts.indexOfX(x));
      setHoverIndex(
        x <= ts.width && y <= plotBottomRef.current && idx >= 0 && idx < marketClient.series.length
          ? idx
          : null,
      );

      if (placeRef.current.kind !== 'idle' || drawDragRef.current) return;

      const drag = dragRef.current;
      if (drag.mode === 'none') {
        const dw = useDrawings.getState();
        if (dw.tool !== 'cursor') {
          setCursorOverride((prev) => (prev === 'crosshair' ? prev : 'crosshair'));
          return;
        }
        if (orderLineAt(x, y)) {
          setCursorOverride((prev) => (prev === 'ns-resize' ? prev : 'ns-resize'));
          return;
        }
        if (drawingAt(x, y)) {
          setCursorOverride((prev) => (prev === 'move' ? prev : 'move'));
          return;
        }
        const hit = hitTest(x, y);
        const next =
          hit.mode === 'paneResize' ? 'row-resize' : hit.mode === 'valueScale' ? 'ns-resize' : null;
        setCursorOverride((prev) => (prev === next ? prev : next));
        return;
      }

      const dx = x - drag.x;
      const dy = y - drag.y;

      if (drag.mode === 'pan') {
        ts.rightIndex -= dx / ts.barSpacing;
        const ps = priceScalesRef.current.get(drag.paneId);
        if (ps && !ps.autoScale) ps.panRange(dy);
        syncFollow();
      } else if (drag.mode === 'valueScale') {
        const ps = priceScalesRef.current.get(drag.paneId);
        if (ps) {
          // Dragging down compresses the axis, like a pro terminal.
          if (drag.paneId === 'main' && ps.autoScale) {
            // Leaving auto-scale on would immediately undo the drag.
            useUi.getState().toggleAutoScale();
            ps.autoScale = false;
          }
          if (!ps.autoScale) ps.scaleRange(Math.exp(dy / 160));
        }
      } else if (drag.mode === 'timeScale') {
        zoom(ts.width, Math.exp(-dx / 160));
      } else if (drag.mode === 'paneResize') {
        const ui = useUi.getState();
        ui.setPaneRatios(
          resizePane(paneIds, ui.paneRatios, drag.index, dy, plotBottomRef.current),
        );
      }
      drag.x = x;
      drag.y = y;
    },
    [zoom, syncFollow, hitTest, paneIds],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const place = placeRef.current;
      if (place.kind === 'dragging') {
        // A channel needs one more click to set how far the parallel sits.
        if (place.tool === 'channel') placeRef.current = { kind: 'awaitingOffset', tool: 'channel', points: place.points };
        else commitPlacement();
      }
      if (drawDragRef.current) {
        useDrawings.getState().commit();
        drawDragRef.current = null;
      }
      lineDragRef.current = null;
      const pendingText = pendingTextRef.current;
      if (pendingText) {
        pendingTextRef.current = null;
        setTextEdit(pendingText);
      }
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      dragRef.current.mode = 'none';
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    },
    [commitPlacement],
  );

  const onPointerLeave = useCallback(() => {
    crosshairRef.current = { ...crosshairRef.current, visible: false };
    setHoverIndex(null);
    setCursorOverride(null);
  }, []);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTest(x, y);
      if (hit.mode === 'valueScale' && hit.paneId === 'main') {
        // Double-click the price axis: back to auto-scale.
        if (!useUi.getState().autoScale) useUi.getState().toggleAutoScale();
        const ps = priceScalesRef.current.get('main');
        if (ps) ps.autoScale = true;
        return;
      }
      resetView();
    },
    [hitTest, resetView],
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
      const ts = timeScaleRef.current;
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        // Trackpad pinch arrives as ctrl+wheel; plain wheel zooms too.
        zoom(Math.min(x, ts.width), Math.exp(-e.deltaY * 0.0022));
      } else {
        ts.rightIndex += e.deltaX / ts.barSpacing;
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

  /**
   * Fit a span of time on screen.
   *
   * A range longer than the loaded history simply shows everything, which is
   * what "All" does and what 1M does on a seconds timeframe.
   */
  const setDateRange = useCallback(
    (range: DateRange) => {
      const ts = timeScaleRef.current;
      const len = marketClient.series.length;
      if (len === 0 || ts.width === 0) return;
      const tfMs = TF_SECONDS[useUi.getState().timeframe] * 1000;
      const bars = Math.max(10, Math.min(len, RANGE_MS[range] / tfMs));
      ts.setBarSpacing(ts.width / bars);
      goRealtime();
      useUi.getState().setActiveRange(range);
    },
    [goRealtime],
  );

  const screenshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const link = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = `DAVIDUSD-${useUi.getState().timeframe}-${stamp}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
      /* canvas export can be blocked; nothing useful to do but skip it */
    }
  }, []);

  useEffect(() => {
    chartController.current = { setDateRange, resetView, scrollToRealtime: goRealtime, screenshot };
    return () => {
      chartController.current = null;
    };
  }, [setDateRange, resetView, goRealtime, screenshot]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = drawingAt(x, y);
      if (!hit) return;
      e.preventDefault();
      useDrawings.getState().select(hit.drawing.id);
      setContextMenu({ x, y, id: hit.drawing.id });
    },
    [drawingAt],
  );

  /** Keyboard shortcuts for the drawing layer. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never steal keys from a field the user is typing in.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }
      const dw = useDrawings.getState();
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) dw.redo();
        else dw.undo();
        return;
      }
      if (e.key === 'Escape') {
        if (placeRef.current.kind !== 'idle') cancelPlacement();
        else if (dw.tool !== 'cursor') dw.setTool('cursor');
        else dw.select(null);
        setContextMenu(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && dw.selectedId) {
        e.preventDefault();
        dw.remove(dw.selectedId);
        return;
      }
      if (e.altKey && e.key.toLowerCase() === 'a') {
        // An alert at the crosshair, pointing the way the price would have to
        // move to reach it.
        e.preventDefault();
        const map = mapRef.current;
        const cross = crosshairRef.current;
        if (!map || !cross.visible) return;
        const price = Math.round(map.priceOfY(cross.y));
        const last = marketClient.quote.last || marketClient.series.lastClose();
        if (!Number.isFinite(price) || price <= 0) return;
        useAlerts.getState().add(price, price >= last ? 'above' : 'below');
        return;
      }
      if (e.altKey && e.key.toLowerCase() === 'h') {
        // Drop a horizontal line at the crosshair, or at the last price.
        e.preventDefault();
        const map = mapRef.current;
        if (!map) return;
        const cross = crosshairRef.current;
        const price = cross.visible
          ? map.priceOfY(cross.y)
          : marketClient.quote.last || marketClient.series.lastClose();
        const time = cross.visible ? map.snapTime(map.timeOfX(cross.x)) : Date.now();
        if (!Number.isFinite(price)) return;
        dw.add(makeDrawing('hline', [{ time, price }], dw.style));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelPlacement]);

  const legendRows: PaneLegendRow[] = useMemo(
    () =>
      paneRects
        .slice(1)
        .map((rect, i) => ({ rect, instance: paneIndicators[i] }))
        .filter((r): r is PaneLegendRow => r.instance !== undefined),
    [paneRects, paneIndicators],
  );

  const cursorCss =
    cursorOverride ??
    (drawingTool !== 'cursor'
      ? 'crosshair'
      : cursorMode === 'arrow'
        ? 'default'
        : cursorMode === 'dot'
          ? 'cell'
          : 'crosshair');

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
        onContextMenu={onContextMenu}
      />
      <div className="chart-overlay-left">
        <ChartLegend hoverIndex={hoverIndex} overlays={overlayIndicators} />
        <QuickTrade />
      </div>
      <PaneLegends rows={legendRows} hoverIndex={hoverIndex} />
      <OrderLineControls />
      {!atRealtime && <ScrollToRealtime onClick={goRealtime} />}
      {contextMenu && (
        <DrawingContextMenu {...contextMenu} onClose={() => setContextMenu(null)} />
      )}
      {textEdit && <TextLabelEditor {...textEdit} onClose={() => setTextEdit(null)} />}
    </div>
  );
}

/** Compute every indicator in a pane, dropping any that fail to resolve. */
function buildItems(
  instances: { id: string; defId: string }[],
  series: Parameters<typeof indicatorEngine.compute>[1],
): PaneItem[] {
  const out: PaneItem[] = [];
  for (const inst of instances) {
    const def = indicatorDef(inst.defId);
    if (!def) continue;
    const full = useUi.getState().indicators.find((i) => i.id === inst.id);
    if (!full) continue;
    const result = indicatorEngine.compute(full, series);
    if (!result) continue;
    out.push({ instance: full, def, result });
  }
  return out;
}

function rectsChanged(a: PaneRect[], b: PaneRect[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as PaneRect;
    const y = b[i] as PaneRect;
    if (x.id !== y.id || x.top !== y.top || x.height !== y.height) return true;
  }
  return false;
}

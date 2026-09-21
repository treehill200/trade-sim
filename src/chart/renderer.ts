import type { CandleSeries } from '@/engine/series';
import { TF_SECONDS, type Timeframe } from '@/engine/timeframes';
import type { ChartTheme } from './theme';
import { PriceScale, TimeScale, clamp } from './scales';
import {
  formatAxisTime,
  formatCents,
  formatCountdown,
  formatFullTime,
  formatVolume,
  isNewDay,
  niceStep,
} from './format';
import type { PlotSeries } from './plotSeries';
import { isCloseOnly, type ChartType } from './chartTypes';
import { drawPriceSeries } from './plots';
import { drawGuides, drawPaneItems, paneValueRange } from './indicatorPlots';
import type { Pane } from './panes';
import { PANE_SEPARATOR } from './panes';
import {
  applyRange,
  autoScaleRange,
  buildColumns,
  crisp,
  visibleRange,
  DENSE_SPACING,
  SILHOUETTE_SPACING,
  type Columns,
} from './geometry';
import type { ValueFormat } from '@/indicators/types';

export const PRICE_AXIS_WIDTH = 74;
export const TIME_AXIS_HEIGHT = 26;

export interface CrosshairState {
  /** Pointer position in CSS pixels relative to the canvas, or null. */
  x: number;
  y: number;
  visible: boolean;
}

export interface RenderInput {
  /** The real candles, used for volume and the last-price marker. */
  series: CandleSeries;
  /** What gets drawn — the same candles, or a derived series like Heikin Ashi. */
  plot: PlotSeries;
  chartType: ChartType;
  timeScale: TimeScale;
  /** Price pane first, then indicator panes top to bottom. */
  panes: Pane[];
  theme: ChartTheme;
  timeframe: Timeframe;
  timeZone: string;
  crosshair: CrosshairState;
  showCrosshairLines: boolean;
  /** Fraction of the price pane given to the volume overlay. */
  volumeHeightRatio: number;
  showVolume: boolean;
  /** True last price, in cents. */
  lastPriceCents: number;
  /**
   * Last price after easing, in cents. The line and axis tag follow this so
   * they glide between ticks instead of jumping.
   */
  smoothPriceCents: number;
  /** Eased close of the newest candle, in the plotted series' units. */
  liveClose: number | null;
  /** Wall clock, used for the candle-close countdown. */
  now: number;
  dpr: number;
}

export function render(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { plot, timeScale: ts, panes, theme, dpr } = input;
  const mainPane = panes[0];
  if (!mainPane) return;
  const totalWidth = ts.width + PRICE_AXIS_WIDTH;
  const lastPane = panes[panes.length - 1] as Pane;
  const plotBottom = lastPane.priceScale.top + lastPane.priceScale.height;
  const totalHeight = plotBottom + TIME_AXIS_HEIGHT;

  ctx.save();
  ctx.clearRect(0, 0, totalWidth, totalHeight);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Below a few pixels per candle, everything downstream reads pixel columns
  // instead of candles.
  const cols = ts.barSpacing < DENSE_SPACING && plot.length > 0 ? buildColumns(plot, ts, dpr) : null;
  const mainScale = mainPane.priceScale;
  if (mainScale.autoScale) {
    autoScaleRange(plot, ts, mainScale, cols, isCloseOnly(input.chartType));
  }
  for (const pane of panes.slice(1)) {
    if (!pane.priceScale.autoScale) continue;
    const { min, max } = paneValueRange(pane, input.series, ts);
    applyRange(pane.priceScale, min, max);
  }

  // Both the grid and the axis need the same ticks; computing them once a
  // frame keeps the date formatting off the hot path.
  const times = timeTicks(input);
  const tickSets = panes.map((p, i) => computeValueTicks(p.priceScale, p.format, i > 0));

  drawVerticalGrid(ctx, input, times, plotBottom);
  panes.forEach((pane, i) => {
    drawHorizontalGrid(ctx, input, pane, tickSets[i] as ValueTick[]);
  });

  // Price pane: volume overlay, then the candles themselves.
  if (input.showVolume) drawVolumeOverlay(ctx, input, mainScale, cols);
  drawPriceSeries(ctx, {
    series: plot,
    timeScale: ts,
    priceScale: mainScale,
    theme,
    chartType: input.chartType,
    dpr,
    columns: cols,
    liveClose: input.liveClose,
  });

  const indicatorInput = { series: input.series, timeScale: ts, theme, dpr };
  for (const pane of panes) {
    drawGuides(ctx, pane, indicatorInput);
    drawPaneItems(ctx, pane, indicatorInput);
  }

  const tagBox = drawLastPriceLine(ctx, input, mainScale);
  panes.forEach((pane, i) => {
    drawValueAxis(ctx, input, pane, tickSets[i] as ValueTick[], i === 0 ? tagBox : null);
  });
  if (tagBox) drawLastPriceTag(ctx, input, tagBox);
  drawTimeAxis(ctx, input, times, plotBottom);
  if (input.crosshair.visible) drawCrosshair(ctx, input, plotBottom);

  drawFrame(ctx, input, plotBottom, totalWidth, totalHeight);
  ctx.restore();
}

/** Axis separators and the draggable gaps between panes. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  plotBottom: number,
  totalWidth: number,
  totalHeight: number,
): void {
  const { timeScale: ts, panes, theme, dpr } = input;
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  ctx.moveTo(crisp(ts.width, dpr), 0);
  ctx.lineTo(crisp(ts.width, dpr), totalHeight);
  ctx.moveTo(0, crisp(plotBottom, dpr));
  ctx.lineTo(totalWidth, crisp(plotBottom, dpr));
  ctx.stroke();

  // A line in the middle of each pane gap, so the boundary is visible and the
  // drag target is obvious.
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  for (let i = 0; i < panes.length - 1; i++) {
    const pane = panes[i] as Pane;
    const y = crisp(pane.priceScale.top + pane.priceScale.height + PANE_SEPARATOR / 2, dpr);
    ctx.moveTo(0, y);
    ctx.lineTo(totalWidth, y);
  }
  ctx.stroke();
}

// --- value axis ------------------------------------------------------------

interface ValueTick {
  value: number;
  y: number;
}

function formatValue(v: number, format: ValueFormat): string {
  if (format === 'volume') return formatVolume(v);
  if (format === 'number') return v.toFixed(Math.abs(v) >= 100 ? 0 : 1);
  return formatCents(v, Math.abs(v) >= 100000 ? 1 : 2);
}

function computeValueTicks(ps: PriceScale, format: ValueFormat, dense: boolean): ValueTick[] {
  const ticks: ValueTick[] = [];
  // Indicator panes are short, so they need labels closer together than the
  // price pane or they end up with a single number on the axis.
  const targetCount = Math.max(2, Math.floor(ps.height / (dense ? 40 : 56)));
  // Prices are integer cents, so never label finer than one tick; other units
  // are free to use whatever step reads best.
  const minStep = format === 'price' ? 1 : 0;

  if (ps.logScale) {
    // On a log axis a constant step bunches up at one end, so step
    // multiplicatively and snap each level to a round-ish number.
    const ratio = Math.pow(ps.range.max / Math.max(ps.range.min, 1), 1 / targetCount);
    let p = ps.range.min;
    for (let i = 0; i <= targetCount + 1 && p <= ps.range.max * 1.001; i++) {
      const step = niceStep(p * (ratio - 1), Math.max(minStep, 1e-6));
      const snapped = Math.ceil(p / step) * step;
      if (snapped > ps.range.max) break;
      ticks.push({ value: snapped, y: ps.yOfPrice(snapped) });
      p = snapped + step;
    }
    return ticks;
  }

  const span = ps.range.max - ps.range.min;
  if (span <= 0) return ticks;
  const step = niceStep(span / targetCount, Math.max(minStep, span / 1e6));
  const start = Math.ceil(ps.range.min / step) * step;
  for (let v = start; v <= ps.range.max; v += step) {
    ticks.push({ value: v, y: ps.yOfPrice(v) });
  }
  return ticks;
}

function drawValueAxis(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  pane: Pane,
  ticks: ValueTick[],
  skip: TagBox | null,
): void {
  const { timeScale: ts, theme } = input;
  const ps = pane.priceScale;
  ctx.save();
  ctx.fillStyle = theme.axisText;
  ctx.font = '400 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    if (t.y < ps.top + 8 || t.y > ps.top + ps.height - 6) continue;
    // Never print a label under the last-price tag.
    if (skip && t.y > skip.y - 6 && t.y < skip.y + skip.height + 6) continue;
    ctx.fillText(formatValue(t.value, pane.format), ts.width + PRICE_AXIS_WIDTH - 8, t.y);
  }

  // Label the reference lines too, so RSI's 30 and 70 are readable without
  // counting gridlines.
  if (pane.guides.length > 0) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = '400 10px Inter, system-ui, sans-serif';
    for (const g of pane.guides) {
      const y = ps.yOfPrice(g);
      if (y < ps.top + 6 || y > ps.top + ps.height - 6) continue;
      if (ticks.some((t) => Math.abs(t.y - y) < 10)) continue;
      ctx.fillText(formatValue(g, pane.format), ts.width + PRICE_AXIS_WIDTH - 8, y);
    }
  }
  ctx.restore();
}

// --- time axis -------------------------------------------------------------

interface TimeTick {
  x: number;
  label: string;
  major: boolean;
}

/**
 * Time-axis ticks.
 *
 * Labels are placed at whole candles so a gridline always lines up with a
 * candle body, and a day boundary is promoted to a "major" tick showing the
 * date instead of the clock.
 */
function timeTicks(input: RenderInput): TimeTick[] {
  const { series, timeScale: ts, timeframe, timeZone } = input;
  const out: TimeTick[] = [];
  if (series.length === 0) return out;

  const minGapPx = 84;
  const strideBars = Math.max(1, Math.ceil(minGapPx / ts.barSpacing));
  const tfMs = TF_SECONDS[timeframe] * 1000;
  // Round the stride up to a whole number of "nice" time units so labels land
  // on tidy clock values rather than arbitrary candles.
  const niceUnits = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440, 2880, 10080];
  const strideMinutes = (strideBars * tfMs) / 60000;
  let unit = niceUnits[niceUnits.length - 1] as number;
  for (const u of niceUnits) {
    if (u >= strideMinutes) {
      unit = u;
      break;
    }
  }
  const unitMs = Math.max(tfMs, unit * 60000);

  const { from, to } = visibleRange(series, ts);
  // The market is continuous, so candle times are evenly spaced: step straight
  // from one label to the next instead of testing every visible candle.
  const stride = Math.max(1, Math.round(unitMs / tfMs));
  const fromTime = series.time[from] as number;
  const offsetToFirst = (unitMs - (fromTime % unitMs)) % unitMs;
  const firstIndex = from + Math.round(offsetToFirst / tfMs);

  let prevLabelTime = Number.NaN;
  for (let i = firstIndex; i <= to; i += stride) {
    if (i < from) continue;
    const t = series.time[i] as number;
    if (t % unitMs !== 0) continue;
    const major = !Number.isNaN(prevLabelTime) && isNewDay(prevLabelTime, t, timeZone);
    const firstOfDay = Number.isNaN(prevLabelTime) || major;
    out.push({
      x: ts.xOfIndex(i),
      label: formatAxisTime(t, timeframe, timeZone, firstOfDay && unitMs >= 3600000 ? true : major),
      major,
    });
    prevLabelTime = t;
  }
  return out;
}

function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  times: TimeTick[],
  plotBottom: number,
): void {
  const { timeScale: ts, theme } = input;
  ctx.save();
  ctx.font = '400 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = plotBottom + TIME_AXIS_HEIGHT / 2;
  for (const t of times) {
    if (t.x < 24 || t.x > ts.width - 24) continue;
    ctx.fillStyle = t.major ? theme.text : theme.axisText;
    ctx.fillText(t.label, t.x, y);
  }
  ctx.restore();
}

function drawVerticalGrid(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  times: TimeTick[],
  plotBottom: number,
): void {
  const { timeScale: ts, theme, dpr } = input;
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  for (const t of times) {
    const x = crisp(t.x, dpr);
    if (x < 0 || x > ts.width) continue;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plotBottom);
  }
  ctx.stroke();
}

function drawHorizontalGrid(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  pane: Pane,
  ticks: ValueTick[],
): void {
  const { timeScale: ts, theme, dpr } = input;
  const ps = pane.priceScale;
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  for (const t of ticks) {
    const y = crisp(t.y, dpr);
    if (y < ps.top || y > ps.top + ps.height) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(ts.width, y);
  }
  ctx.stroke();
}

// --- volume overlay --------------------------------------------------------

function drawVolumeOverlay(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  ps: PriceScale,
  cols: Columns | null,
): void {
  const { series, timeScale: ts, theme, dpr } = input;
  const { from, to } = visibleRange(series, ts);
  if (to < from) return;

  // Each column already holds the largest volume it covers, so the columns
  // give the same maximum as the raw candles for a fraction of the work.
  let maxVol = 0;
  if (cols) {
    for (let i = 0; i < cols.count; i++) {
      const v = cols.volume[i] as number;
      if (v > maxVol) maxVol = v;
    }
  } else {
    for (let i = from; i <= to; i++) {
      const v = series.volume[i] as number;
      if (v > maxVol) maxVol = v;
    }
  }
  if (maxVol <= 0) return;

  const zone = ps.height * input.volumeHeightRatio;
  const base = ps.top + ps.height;
  const spacing = ts.barSpacing;
  const w = 1 / dpr;

  if (cols && spacing < SILHOUETTE_SPACING) {
    // Thousands of half-pixel rects are expensive to rasterise and their
    // per-candle colours are invisible at this density, so the histogram is
    // drawn as one continuous silhouette instead.
    const silhouette = new Path2D();
    silhouette.moveTo(cols.x[0] as number, base);
    for (let i = 0; i < cols.count; i++) {
      const x = cols.x[i] as number;
      const h = Math.max(w, ((cols.volume[i] as number) / maxVol) * zone);
      silhouette.lineTo(x, base - h);
      silhouette.lineTo(x + w, base - h);
    }
    silhouette.lineTo((cols.x[cols.count - 1] as number) + w, base);
    silhouette.closePath();
    const gradient = ctx.createLinearGradient(0, base - zone, 0, base);
    gradient.addColorStop(0, theme.volumeNeutral);
    gradient.addColorStop(1, theme.volumeNeutralFaded);
    ctx.fillStyle = gradient;
    ctx.fill(silhouette);
    return;
  }

  const barWidth = Math.max(w, Math.floor(spacing * 0.72) || w);
  const up = new Path2D();
  const down = new Path2D();
  for (let i = from; i <= to; i++) {
    const x = ts.xOfIndex(i);
    if (x < -spacing || x > ts.width + spacing) continue;
    const h = Math.max(w, ((series.volume[i] as number) / maxVol) * zone);
    const isUp = (series.close[i] as number) >= (series.open[i] as number);
    (isUp ? up : down).rect(x - barWidth / 2, base - h, barWidth, h);
  }
  ctx.fillStyle = theme.volumeUp;
  ctx.fill(up);
  ctx.fillStyle = theme.volumeDown;
  ctx.fill(down);
}

// --- last price ------------------------------------------------------------

/** Vertical slice of the price axis occupied by the last-price tag. */
export interface TagBox {
  y: number;
  height: number;
  up: boolean;
  price: number;
}

const TAG_HEIGHT = 30;

/**
 * Dashed line at the last traded price, with a soft glow and a pulse dot.
 *
 * Returns the box its axis tag will occupy so the axis can leave that space
 * blank instead of drawing a label underneath it.
 */
function drawLastPriceLine(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  ps: PriceScale,
): TagBox | null {
  const { series, timeScale: ts, theme, dpr, smoothPriceCents } = input;
  if (series.length === 0 || !Number.isFinite(smoothPriceCents)) return null;
  const y = ps.yOfPrice(smoothPriceCents);
  const top = ps.top;
  const bottom = ps.top + ps.height;
  if (y < top - TAG_HEIGHT || y > bottom + TAG_HEIGHT) return null;

  const i = series.length - 1;
  const up = (series.close[i] as number) >= (series.open[i] as number);

  if (y >= top && y <= bottom) {
    const cy = crisp(y, dpr);
    ctx.save();
    // Glow first, then the crisp dashed line on top of it.
    ctx.strokeStyle = theme.lastPriceGlow;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(ts.width, cy);
    ctx.stroke();

    ctx.setLineDash([4 / dpr, 4 / dpr]);
    ctx.strokeStyle = theme.lastPriceLine;
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(ts.width, cy);
    ctx.stroke();
    ctx.restore();

    // A dot at the newest candle, breathing once per second.
    const x = ts.xOfIndex(i);
    if (x >= 0 && x <= ts.width) {
      const phase = (input.now % 1000) / 1000;
      const pulse = 3 + 2.5 * (1 - phase);
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.22 * (1 - phase);
      ctx.fillStyle = up ? theme.up : theme.down;
      ctx.beginPath();
      ctx.arc(x, y, pulse + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  return {
    y: clamp(y - TAG_HEIGHT / 2, top, Math.max(top, bottom - TAG_HEIGHT)),
    height: TAG_HEIGHT,
    up,
    price: smoothPriceCents,
  };
}

/** The price tag on the axis, with a countdown to this candle's close. */
function drawLastPriceTag(ctx: CanvasRenderingContext2D, input: RenderInput, box: TagBox): void {
  const { series, timeScale: ts, theme } = input;
  const i = series.length - 1;
  const tfMs = TF_SECONDS[input.timeframe] * 1000;
  const remaining = (series.time[i] as number) + tfMs - input.now;

  ctx.save();
  ctx.fillStyle = box.up ? theme.up : theme.down;
  ctx.fillRect(ts.width + 1, box.y, PRICE_AXIS_WIDTH - 1, box.height);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  ctx.fillText(
    formatCents(Math.round(input.lastPriceCents)),
    ts.width + PRICE_AXIS_WIDTH / 2,
    box.y + 10,
    PRICE_AXIS_WIDTH - 6,
  );
  ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
  ctx.globalAlpha = 0.85;
  ctx.fillText(
    formatCountdown(remaining),
    ts.width + PRICE_AXIS_WIDTH / 2,
    box.y + 21,
    PRICE_AXIS_WIDTH - 6,
  );
  ctx.restore();
}

// --- crosshair -------------------------------------------------------------

/** The pane containing `y`, or the closest one when `y` is in a gap. */
function paneAt(panes: Pane[], y: number): Pane | undefined {
  let best: Pane | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const pane of panes) {
    const ps = pane.priceScale;
    if (ps.contains(y)) return pane;
    const distance = y < ps.top ? ps.top - y : y - (ps.top + ps.height);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = pane;
    }
  }
  return best;
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  plotBottom: number,
): void {
  const { series, timeScale: ts, panes, theme, dpr, crosshair } = input;
  const { x, y } = crosshair;
  if (x > ts.width || y > plotBottom) return;

  // Snap horizontally to the centre of the candle under the pointer.
  const idx = Math.round(ts.indexOfX(x));
  const snapX = ts.xOfIndex(idx);
  // The pane the pointer is in owns the horizontal line and the value label;
  // the vertical line runs through every pane so they stay in step. In the
  // gap between two panes, the nearer one wins — falling back to the price
  // pane there would print a price extrapolated far outside its own range.
  const pane = paneAt(panes, y);
  if (!pane) return;

  ctx.save();
  ctx.strokeStyle = theme.crosshair;
  ctx.lineWidth = 1 / dpr;
  ctx.setLineDash([4 / dpr, 4 / dpr]);
  ctx.beginPath();
  ctx.moveTo(crisp(snapX, dpr), 0);
  ctx.lineTo(crisp(snapX, dpr), plotBottom);
  if (input.showCrosshairLines) {
    ctx.moveTo(0, crisp(y, dpr));
    ctx.lineTo(ts.width, crisp(y, dpr));
  }
  ctx.stroke();
  ctx.restore();

  if (!input.showCrosshairLines && idx >= 0 && idx < series.length) {
    // Dot cursor: a marker on the candle instead of a full-width line.
    ctx.save();
    ctx.fillStyle = theme.crosshair;
    ctx.beginPath();
    ctx.arc(snapX, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Value label on the axis, in the units of the pane being hovered.
  const value = pane.priceScale.priceOfY(y);
  ctx.save();
  ctx.fillStyle = theme.crosshairLabelBg;
  ctx.fillRect(ts.width + 1, y - 9, PRICE_AXIS_WIDTH - 1, 18);
  ctx.fillStyle = theme.crosshairLabelText;
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    formatValue(pane.format === 'price' ? Math.round(value) : value, pane.format),
    ts.width + PRICE_AXIS_WIDTH / 2,
    y,
    PRICE_AXIS_WIDTH - 6,
  );
  ctx.restore();

  // Time label on the time axis.
  if (idx >= 0 && idx < series.length) {
    const t = series.time[idx] as number;
    const label = formatFullTime(t, input.timeframe, input.timeZone);
    ctx.save();
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    const w = ctx.measureText(label).width + 16;
    const bx = clamp(snapX - w / 2, 0, ts.width - w);
    ctx.fillStyle = theme.crosshairLabelBg;
    ctx.fillRect(bx, plotBottom + 2, w, TIME_AXIS_HEIGHT - 4);
    ctx.fillStyle = theme.crosshairLabelText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + w / 2, plotBottom + TIME_AXIS_HEIGHT / 2);
    ctx.restore();
  }
}

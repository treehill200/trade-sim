import type { CandleSeries } from '@/engine/series';
import { TF_SECONDS, type Timeframe } from '@/engine/timeframes';
import type { ChartTheme } from './theme';
import { Viewport, clamp } from './viewport';
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
import {
  autoScaleRange,
  buildColumns,
  crisp,
  visibleRange,
  DENSE_SPACING,
  SILHOUETTE_SPACING,
  type Columns,
} from './geometry';

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
  viewport: Viewport;
  theme: ChartTheme;
  timeframe: Timeframe;
  timeZone: string;
  crosshair: CrosshairState;
  showCrosshairLines: boolean;
  /** Fraction of plot height given to the volume overlay. */
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
  const { plot, viewport: vp, theme, dpr } = input;
  const totalWidth = vp.width + PRICE_AXIS_WIDTH;
  const totalHeight = vp.height + TIME_AXIS_HEIGHT;

  ctx.save();
  ctx.clearRect(0, 0, totalWidth, totalHeight);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Below a few pixels per candle, everything downstream reads pixel columns
  // instead of candles.
  const cols = vp.barSpacing < DENSE_SPACING && plot.length > 0 ? buildColumns(plot, vp, dpr) : null;
  if (vp.autoScale) autoScaleRange(plot, vp, cols, isCloseOnly(input.chartType));

  const priceTicks = computePriceTicks(vp);
  // Both the grid and the axis need the same ticks; computing them once a
  // frame keeps the date formatting off the hot path.
  const times = timeTicks(input);

  drawGrid(ctx, input, priceTicks, times);
  if (input.showVolume) drawVolume(ctx, input, cols);
  drawPriceSeries(ctx, {
    series: plot,
    viewport: vp,
    theme,
    chartType: input.chartType,
    dpr,
    columns: cols,
    liveClose: input.liveClose,
  });
  const tagBox = drawLastPriceLine(ctx, input);
  drawPriceAxis(ctx, input, priceTicks, tagBox);
  if (tagBox) drawLastPriceTag(ctx, input, tagBox);
  drawTimeAxis(ctx, input, times);
  if (input.crosshair.visible) drawCrosshair(ctx, input);

  // Axis separators.
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  ctx.moveTo(crisp(vp.width, dpr), 0);
  ctx.lineTo(crisp(vp.width, dpr), totalHeight);
  ctx.moveTo(0, crisp(vp.height, dpr));
  ctx.lineTo(totalWidth, crisp(vp.height, dpr));
  ctx.stroke();

  ctx.restore();
}

// --- price axis ------------------------------------------------------------

interface PriceTick {
  price: number;
  y: number;
}

function computePriceTicks(vp: Viewport): PriceTick[] {
  const ticks: PriceTick[] = [];
  const targetCount = Math.max(2, Math.floor(vp.height / 56));
  if (vp.logScale) {
    // On a log axis a constant price step bunches up at one end, so step
    // multiplicatively and snap each level to a round-ish number.
    const ratio = Math.pow(vp.range.max / Math.max(vp.range.min, 1), 1 / targetCount);
    let p = vp.range.min;
    for (let i = 0; i <= targetCount + 1 && p <= vp.range.max * 1.001; i++) {
      const step = niceStep(p * (ratio - 1), 1);
      const snapped = Math.ceil(p / step) * step;
      if (snapped > vp.range.max) break;
      ticks.push({ price: snapped, y: vp.yOfPrice(snapped) });
      p = snapped + step;
    }
    return ticks;
  }
  const span = vp.range.max - vp.range.min;
  const step = niceStep(span / targetCount, 1);
  const start = Math.ceil(vp.range.min / step) * step;
  for (let p = start; p <= vp.range.max; p += step) {
    ticks.push({ price: p, y: vp.yOfPrice(p) });
  }
  return ticks;
}

function drawPriceAxis(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  ticks: PriceTick[],
  skip: TagBox | null,
): void {
  const { viewport: vp, theme } = input;
  ctx.save();
  ctx.fillStyle = theme.axisText;
  ctx.font = '400 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    if (t.y < 8 || t.y > vp.height - 4) continue;
    // Never print a label under the last-price tag.
    if (skip && t.y > skip.y - 6 && t.y < skip.y + skip.height + 6) continue;
    ctx.fillText(formatCents(t.price, t.price >= 100000 ? 1 : 2), vp.width + PRICE_AXIS_WIDTH - 8, t.y);
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
  const { series, viewport: vp, timeframe, timeZone } = input;
  const out: TimeTick[] = [];
  if (series.length === 0) return out;

  const minGapPx = 84;
  const strideBars = Math.max(1, Math.ceil(minGapPx / vp.barSpacing));
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

  const { from, to } = visibleRange(series, vp);
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
      x: vp.xOfIndex(i),
      label: formatAxisTime(t, timeframe, timeZone, firstOfDay && unitMs >= 3600000 ? true : major),
      major,
    });
    prevLabelTime = t;
  }
  return out;
}

function drawTimeAxis(ctx: CanvasRenderingContext2D, input: RenderInput, times: TimeTick[]): void {
  const { viewport: vp, theme } = input;
  ctx.save();
  ctx.font = '400 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = vp.height + TIME_AXIS_HEIGHT / 2;
  for (const t of times) {
    if (t.x < 24 || t.x > vp.width - 24) continue;
    ctx.fillStyle = t.major ? theme.text : theme.axisText;
    ctx.fillText(t.label, t.x, y);
  }
  ctx.restore();
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  ticks: PriceTick[],
  times: TimeTick[],
): void {
  const { viewport: vp, theme, dpr } = input;
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  for (const t of ticks) {
    const y = crisp(t.y, dpr);
    if (y < 0 || y > vp.height) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(vp.width, y);
  }
  for (const t of times) {
    const x = crisp(t.x, dpr);
    if (x < 0 || x > vp.width) continue;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, vp.height);
  }
  ctx.stroke();
}

// --- volume ----------------------------------------------------------------

function drawVolume(ctx: CanvasRenderingContext2D, input: RenderInput, cols: Columns | null): void {
  const { series, viewport: vp, theme, dpr } = input;
  const { from, to } = visibleRange(series, vp);
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

  const zone = vp.height * input.volumeHeightRatio;
  const base = vp.height;
  const spacing = vp.barSpacing;
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
    const x = vp.xOfIndex(i);
    if (x < -spacing || x > vp.width + spacing) continue;
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
function drawLastPriceLine(ctx: CanvasRenderingContext2D, input: RenderInput): TagBox | null {
  const { series, viewport: vp, theme, dpr, smoothPriceCents } = input;
  if (series.length === 0 || !Number.isFinite(smoothPriceCents)) return null;
  const y = vp.yOfPrice(smoothPriceCents);
  if (y < -TAG_HEIGHT || y > vp.height + TAG_HEIGHT) return null;

  const i = series.length - 1;
  const up = (series.close[i] as number) >= (series.open[i] as number);

  if (y >= 0 && y <= vp.height) {
    const cy = crisp(y, dpr);
    ctx.save();
    // Glow first, then the crisp dashed line on top of it.
    ctx.strokeStyle = theme.lastPriceGlow;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(vp.width, cy);
    ctx.stroke();

    ctx.setLineDash([4 / dpr, 4 / dpr]);
    ctx.strokeStyle = theme.lastPriceLine;
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(vp.width, cy);
    ctx.stroke();
    ctx.restore();

    // A dot at the newest candle, breathing once per second.
    const x = vp.xOfIndex(i);
    if (x >= 0 && x <= vp.width) {
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
    y: clamp(y - TAG_HEIGHT / 2, 0, Math.max(0, vp.height - TAG_HEIGHT)),
    height: TAG_HEIGHT,
    up,
    price: smoothPriceCents,
  };
}

/** The price tag on the axis, with a countdown to this candle's close. */
function drawLastPriceTag(ctx: CanvasRenderingContext2D, input: RenderInput, box: TagBox): void {
  const { series, viewport: vp, theme } = input;
  const i = series.length - 1;
  const tfMs = TF_SECONDS[input.timeframe] * 1000;
  const remaining = (series.time[i] as number) + tfMs - input.now;

  ctx.save();
  ctx.fillStyle = box.up ? theme.up : theme.down;
  ctx.fillRect(vp.width + 1, box.y, PRICE_AXIS_WIDTH - 1, box.height);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  ctx.fillText(
    formatCents(Math.round(input.lastPriceCents)),
    vp.width + PRICE_AXIS_WIDTH / 2,
    box.y + 10,
    PRICE_AXIS_WIDTH - 6,
  );
  ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
  ctx.globalAlpha = 0.85;
  ctx.fillText(
    formatCountdown(remaining),
    vp.width + PRICE_AXIS_WIDTH / 2,
    box.y + 21,
    PRICE_AXIS_WIDTH - 6,
  );
  ctx.restore();
}

// --- crosshair -------------------------------------------------------------

function drawCrosshair(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { series, viewport: vp, theme, dpr, crosshair } = input;
  const { x, y } = crosshair;
  if (x > vp.width || y > vp.height) return;

  // Snap horizontally to the centre of the candle under the pointer.
  const idx = Math.round(vp.indexOfX(x));
  const snapX = vp.xOfIndex(idx);

  if (input.showCrosshairLines) {
    ctx.save();
    ctx.strokeStyle = theme.crosshair;
    ctx.lineWidth = 1 / dpr;
    ctx.setLineDash([4 / dpr, 4 / dpr]);
    ctx.beginPath();
    ctx.moveTo(crisp(snapX, dpr), 0);
    ctx.lineTo(crisp(snapX, dpr), vp.height);
    ctx.moveTo(0, crisp(y, dpr));
    ctx.lineTo(vp.width, crisp(y, dpr));
    ctx.stroke();
    ctx.restore();
  } else if (idx >= 0 && idx < series.length) {
    // Dot cursor: a marker on the candle instead of full-height lines.
    ctx.save();
    ctx.fillStyle = theme.crosshair;
    ctx.beginPath();
    ctx.arc(snapX, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Price label on the price axis.
  const price = vp.priceOfY(y);
  ctx.save();
  ctx.fillStyle = theme.crosshairLabelBg;
  ctx.fillRect(vp.width + 1, y - 9, PRICE_AXIS_WIDTH - 1, 18);
  ctx.fillStyle = theme.crosshairLabelText;
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatCents(Math.round(price)), vp.width + PRICE_AXIS_WIDTH / 2, y, PRICE_AXIS_WIDTH - 6);
  ctx.restore();

  // Time label on the time axis.
  if (idx >= 0 && idx < series.length) {
    const t = series.time[idx] as number;
    const label = formatFullTime(t, input.timeframe, input.timeZone);
    ctx.save();
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    const w = ctx.measureText(label).width + 16;
    const bx = clamp(snapX - w / 2, 0, vp.width - w);
    ctx.fillStyle = theme.crosshairLabelBg;
    ctx.fillRect(bx, vp.height + 2, w, TIME_AXIS_HEIGHT - 4);
    ctx.fillStyle = theme.crosshairLabelText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + w / 2, vp.height + TIME_AXIS_HEIGHT / 2);
    ctx.restore();
  }
}

/** Volume readout for the legend; kept here so formatting stays in one place. */
export function legendVolume(v: number): string {
  return formatVolume(v);
}

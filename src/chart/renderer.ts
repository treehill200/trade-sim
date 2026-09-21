import type { CandleSeries } from '@/engine/series';
import type { Timeframe } from '@/engine/timeframes';
import { TF_SECONDS } from '@/engine/timeframes';
import type { ChartTheme } from './theme';
import { Viewport, clamp } from './viewport';
import { formatAxisTime, formatCents, formatCountdown, formatFullTime, isNewDay, niceStep } from './format';

export const PRICE_AXIS_WIDTH = 74;
export const TIME_AXIS_HEIGHT = 26;

export interface CrosshairState {
  /** Pointer position in CSS pixels relative to the canvas, or null. */
  x: number;
  y: number;
  visible: boolean;
}

export interface RenderInput {
  series: CandleSeries;
  viewport: Viewport;
  theme: ChartTheme;
  timeframe: Timeframe;
  timeZone: string;
  crosshair: CrosshairState;
  /** Fraction of plot height given to the volume overlay. */
  volumeHeightRatio: number;
  showVolume: boolean;
  lastPriceCents: number;
  /** Wall clock, used for the candle-close countdown. */
  now: number;
  dpr: number;
}

/** Snap a coordinate so a 1-device-pixel line lands exactly on a pixel. */
function crisp(v: number, dpr: number): number {
  return Math.round(v * dpr - 0.5) / dpr + 0.5 / dpr;
}

/** Visible index window, clamped to the series. */
export function visibleRange(series: CandleSeries, vp: Viewport): { from: number; to: number } {
  const from = Math.max(0, Math.floor(vp.leftIndex) - 1);
  const to = Math.min(series.length - 1, Math.ceil(vp.rightIndex) + 1);
  return { from, to };
}

/**
 * One entry per screen pixel column, used when candles are narrower than a
 * pixel.
 *
 * At full zoom-out a 30-day 1m chart has ~30,000 candles on screen. Reducing
 * them to pixel columns once per frame — instead of once for the auto-scale,
 * once for the candles and once for the volume — is what keeps that view at
 * 60fps. The buffers are module-level and reused so the hot path allocates
 * nothing.
 */
interface Columns {
  count: number;
  x: Float64Array;
  high: Int32Array;
  low: Int32Array;
  open: Int32Array;
  close: Int32Array;
  volume: Float64Array;
}

const columns: Columns = {
  count: 0,
  x: new Float64Array(0),
  high: new Int32Array(0),
  low: new Int32Array(0),
  open: new Int32Array(0),
  close: new Int32Array(0),
  volume: new Float64Array(0),
};

function ensureColumns(n: number): void {
  if (columns.x.length >= n) return;
  const cap = Math.max(n, 2048);
  columns.x = new Float64Array(cap);
  columns.high = new Int32Array(cap);
  columns.low = new Int32Array(cap);
  columns.open = new Int32Array(cap);
  columns.close = new Int32Array(cap);
  columns.volume = new Float64Array(cap);
}

/** Reduce the visible candles to one entry per device-pixel column. */
function buildColumns(series: CandleSeries, vp: Viewport, dpr: number): Columns {
  const { from, to } = visibleRange(series, vp);
  ensureColumns(Math.ceil(vp.width * dpr) + 4);
  let n = 0;
  let colX = Number.NaN;
  for (let i = from; i <= to; i++) {
    const x = vp.xOfIndex(i);
    if (x < -1) continue;
    if (x > vp.width + 1) break;
    const px = Math.round(x * dpr) / dpr;
    if (px !== colX) {
      colX = px;
      n += 1;
      if (n > columns.x.length) break;
      const k = n - 1;
      columns.x[k] = px;
      columns.open[k] = series.open[i] as number;
      columns.high[k] = series.high[i] as number;
      columns.low[k] = series.low[i] as number;
      columns.close[k] = series.close[i] as number;
      columns.volume[k] = series.volume[i] as number;
      continue;
    }
    const k = n - 1;
    const h = series.high[i] as number;
    const l = series.low[i] as number;
    if (h > (columns.high[k] as number)) columns.high[k] = h;
    if (l < (columns.low[k] as number)) columns.low[k] = l;
    columns.close[k] = series.close[i] as number;
    const v = series.volume[i] as number;
    if (v > (columns.volume[k] as number)) columns.volume[k] = v;
  }
  columns.count = n;
  return columns;
}

/** Auto-scale the price range to the visible candles, with padding. */
export function autoScaleRange(series: CandleSeries, vp: Viewport, cols?: Columns): void {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  if (cols) {
    for (let i = 0; i < cols.count; i++) {
      const h = cols.high[i] as number;
      const l = cols.low[i] as number;
      if (h > max) max = h;
      if (l < min) min = l;
    }
  } else {
    const { from, to } = visibleRange(series, vp);
    if (to < from) return;
    for (let i = from; i <= to; i++) {
      const h = series.high[i] as number;
      const l = series.low[i] as number;
      if (h > max) max = h;
      if (l < min) min = l;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return;
  if (max === min) {
    min -= 50;
    max += 50;
  }
  const span = max - min;
  vp.range = {
    min: Math.max(1, min - span * vp.paddingBottom),
    max: max + span * vp.paddingTop,
  };
}

export function render(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { series, viewport: vp, theme, dpr } = input;
  const totalWidth = vp.width + PRICE_AXIS_WIDTH;
  const totalHeight = vp.height + TIME_AXIS_HEIGHT;

  ctx.save();
  ctx.clearRect(0, 0, totalWidth, totalHeight);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Below one candle per pixel, everything downstream reads pixel columns
  // instead of candles.
  const cols = vp.barSpacing < 1 && series.length > 0 ? buildColumns(series, vp, dpr) : null;
  if (vp.autoScale) autoScaleRange(series, vp, cols ?? undefined);

  const priceTicks = computePriceTicks(vp);
  // Both the grid and the axis need the same ticks; computing them once a
  // frame keeps the date formatting off the hot path.
  const times = timeTicks(input);
  drawGrid(ctx, input, priceTicks, times);
  if (input.showVolume) drawVolume(ctx, input, cols);
  drawCandles(ctx, input, cols);
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

function drawCandles(ctx: CanvasRenderingContext2D, input: RenderInput, cols: Columns | null): void {
  const { series, viewport: vp, theme, dpr } = input;
  const { from, to } = visibleRange(series, vp);
  if (to < from) return;

  const spacing = vp.barSpacing;
  const thin = spacing < 3.5;

  // Batch into two paths so the number of fill calls stays constant no matter
  // how many candles are on screen.
  const upBodies = new Path2D();
  const downBodies = new Path2D();
  const upWicks = new Path2D();
  const downWicks = new Path2D();

  if (cols) {
    drawColumnCandles(input, cols, upWicks, downWicks);
  } else if (thin) {
    drawThinCandles(input, upWicks, downWicks);
  } else {
    const bodyWidth = Math.max(1, Math.floor(spacing * 0.72));
    const halfBody = bodyWidth / 2;
    const wickWidth = Math.max(1 / dpr, Math.min(2, spacing * 0.12));

    for (let i = from; i <= to; i++) {
      const x = vp.xOfIndex(i);
      if (x < -spacing || x > vp.width + spacing) continue;
      const o = series.open[i] as number;
      const c = series.close[i] as number;
      const up = c >= o;

      const cx = crisp(x, dpr);
      const yHigh = vp.yOfPrice(series.high[i] as number);
      const yLow = vp.yOfPrice(series.low[i] as number);
      (up ? upWicks : downWicks).rect(
        cx - wickWidth / 2,
        yHigh,
        wickWidth,
        Math.max(1 / dpr, yLow - yHigh),
      );

      const yOpen = vp.yOfPrice(o);
      const yClose = vp.yOfPrice(c);
      const top = Math.min(yOpen, yClose);
      const height = Math.max(1 / dpr, Math.abs(yClose - yOpen));
      (up ? upBodies : downBodies).rect(
        crisp(x - halfBody, dpr),
        Math.round(top * dpr) / dpr,
        bodyWidth,
        height,
      );
    }
  }

  ctx.fillStyle = theme.upWick;
  ctx.fill(upWicks);
  ctx.fillStyle = theme.downWick;
  ctx.fill(downWicks);
  ctx.fillStyle = theme.upFill;
  ctx.fill(upBodies);
  ctx.fillStyle = theme.downFill;
  ctx.fill(downBodies);
}

/** Draw one hairline per pre-reduced pixel column. */
function drawColumnCandles(
  input: RenderInput,
  cols: Columns,
  upPath: Path2D,
  downPath: Path2D,
): void {
  const { viewport: vp, dpr } = input;
  const w = 1 / dpr;
  for (let i = 0; i < cols.count; i++) {
    const yHigh = vp.yOfPrice(cols.high[i] as number);
    const yLow = vp.yOfPrice(cols.low[i] as number);
    const path = (cols.close[i] as number) >= (cols.open[i] as number) ? upPath : downPath;
    path.rect(cols.x[i] as number, yHigh, w, Math.max(w, yLow - yHigh));
  }
}

/**
 * Render densely packed candles as one hairline per screen pixel.
 *
 * Once several candles share a pixel column, drawing them individually is
 * wasted work — at full zoom-out that would be tens of thousands of rects per
 * frame. Collapsing each column into a single high/low bar keeps the shape of
 * the market intact and the frame budget flat no matter how far out you zoom.
 */
function drawThinCandles(input: RenderInput, upPath: Path2D, downPath: Path2D): void {
  const { series, viewport: vp, dpr } = input;
  const { from, to } = visibleRange(series, vp);
  const minWidth = 1 / dpr;

  let colX = Number.NaN;
  let colHigh = Number.NEGATIVE_INFINITY;
  let colLow = Number.POSITIVE_INFINITY;
  let colOpen = 0;
  let colClose = 0;
  let colCount = 0;

  const flush = (): void => {
    if (colCount === 0) return;
    const yHigh = vp.yOfPrice(colHigh);
    const yLow = vp.yOfPrice(colLow);
    const path = colClose >= colOpen ? upPath : downPath;
    path.rect(colX, yHigh, minWidth, Math.max(minWidth, yLow - yHigh));
    colCount = 0;
    colHigh = Number.NEGATIVE_INFINITY;
    colLow = Number.POSITIVE_INFINITY;
  };

  for (let i = from; i <= to; i++) {
    const x = vp.xOfIndex(i);
    if (x < -1 || x > vp.width + 1) continue;
    const px = Math.round(x * dpr) / dpr;
    if (px !== colX) {
      flush();
      colX = px;
      colOpen = series.open[i] as number;
    }
    const h = series.high[i] as number;
    const l = series.low[i] as number;
    if (h > colHigh) colHigh = h;
    if (l < colLow) colLow = l;
    colClose = series.close[i] as number;
    colCount += 1;
  }
  flush();
}

function drawVolume(ctx: CanvasRenderingContext2D, input: RenderInput, cols: Columns | null): void {
  const { series, viewport: vp, theme, dpr } = input;
  const { from, to } = visibleRange(series, vp);
  if (to < from) return;

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
  const barWidth = Math.max(1 / dpr, Math.floor(spacing * 0.72) || 1 / dpr);
  // Below one pixel per bar, collapse each pixel column into a single bar.
  const collapse = spacing < 1;

  const up = new Path2D();
  const down = new Path2D();

  if (cols) {
    // Thousands of half-pixel rects are expensive to rasterise and their
    // per-candle colours are invisible at this density, so the histogram is
    // drawn as one continuous silhouette instead.
    const silhouette = new Path2D();
    const w = 1 / dpr;
    silhouette.moveTo(cols.x[0] as number, base);
    for (let i = 0; i < cols.count; i++) {
      const x = cols.x[i] as number;
      const h = Math.max(w, ((cols.volume[i] as number) / maxVol) * zone);
      silhouette.lineTo(x, base - h);
      silhouette.lineTo(x + w, base - h);
    }
    silhouette.lineTo((cols.x[cols.count - 1] as number) + w, base);
    silhouette.closePath();
    ctx.fillStyle = theme.volumeNeutral;
    ctx.fill(silhouette);
    return;
  }

  let colX = Number.NaN;
  let colVol = 0;
  let colUp = true;

  const flush = (): void => {
    if (Number.isNaN(colX)) return;
    const h = Math.max(1 / dpr, (colVol / maxVol) * zone);
    (colUp ? up : down).rect(colX, base - h, 1 / dpr, h);
  };

  for (let i = from; i <= to; i++) {
    const x = vp.xOfIndex(i);
    if (x < -spacing || x > vp.width + spacing) continue;
    const v = series.volume[i] as number;
    const isUp = (series.close[i] as number) >= (series.open[i] as number);
    if (!collapse) {
      const h = Math.max(1 / dpr, (v / maxVol) * zone);
      (isUp ? up : down).rect(x - barWidth / 2, base - h, barWidth, h);
      continue;
    }
    const px = Math.round(x * dpr) / dpr;
    if (px !== colX) {
      flush();
      colX = px;
      colVol = 0;
    }
    if (v > colVol) colVol = v;
    colUp = isUp;
  }
  if (collapse) flush();

  ctx.fillStyle = theme.volumeUp;
  ctx.fill(up);
  ctx.fillStyle = theme.volumeDown;
  ctx.fill(down);
}

/** Vertical slice of the price axis occupied by the last-price tag. */
export interface TagBox {
  y: number;
  height: number;
  up: boolean;
  price: number;
}

const TAG_HEIGHT = 30;

/**
 * Dashed line at the last traded price. Returns the box its axis tag will
 * occupy so the axis can leave that space blank instead of drawing a label
 * underneath it.
 */
function drawLastPriceLine(ctx: CanvasRenderingContext2D, input: RenderInput): TagBox | null {
  const { series, viewport: vp, theme, dpr, lastPriceCents } = input;
  if (series.length === 0 || !Number.isFinite(lastPriceCents)) return null;
  const y = vp.yOfPrice(lastPriceCents);
  if (y < 0 || y > vp.height) return null;

  const i = series.length - 1;
  const up = (series.close[i] as number) >= (series.open[i] as number);

  ctx.save();
  ctx.setLineDash([4 / dpr, 4 / dpr]);
  ctx.strokeStyle = theme.lastPriceLine;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  const cy = crisp(y, dpr);
  ctx.moveTo(0, cy);
  ctx.lineTo(vp.width, cy);
  ctx.stroke();
  ctx.restore();

  return {
    y: clamp(y - TAG_HEIGHT / 2, 0, Math.max(0, vp.height - TAG_HEIGHT)),
    height: TAG_HEIGHT,
    up,
    price: lastPriceCents,
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
  ctx.fillText(formatCents(box.price), vp.width + PRICE_AXIS_WIDTH / 2, box.y + 10, PRICE_AXIS_WIDTH - 6);
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

function drawCrosshair(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { series, viewport: vp, theme, dpr, crosshair } = input;
  const { x, y } = crosshair;
  if (x > vp.width || y > vp.height) return;

  // Snap horizontally to the centre of the candle under the pointer.
  const idx = Math.round(vp.indexOfX(x));
  const snapX = vp.xOfIndex(idx);

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

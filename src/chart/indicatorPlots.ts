import type { CandleSeries } from '@/engine/series';
import type { ChartTheme } from './theme';
import type { PriceScale, TimeScale } from './scales';
import { crisp, visibleRange } from './geometry';
import type { Pane, PaneItem } from './panes';

/**
 * Drawing for indicator outputs.
 *
 * Indicator series are plain `Float64Array`s with NaN in the warm-up region,
 * so every routine here treats NaN as "pen up" and breaks the path rather
 * than drawing a line to nowhere.
 */

export interface IndicatorPlotInput {
  series: CandleSeries;
  timeScale: TimeScale;
  theme: ChartTheme;
  dpr: number;
}

/**
 * One entry per screen pixel column for a single indicator series.
 *
 * Zoomed all the way out there are tens of thousands of candles on screen.
 * Building a path with a point — let alone a rectangle — per candle produces
 * geometry the rasteriser then spends a hundred milliseconds on, and none of
 * that shows up in a timer around the drawing code because canvas work is
 * deferred to paint. Reducing to pixel columns first keeps every indicator's
 * cost bounded by the width of the chart.
 *
 * Columns are CSS pixels rather than device pixels: at this density the line
 * is a solid band either way, and it halves the work on a HiDPI screen.
 */
interface ValueColumns {
  count: number;
  x: Float64Array;
  min: Float64Array;
  max: Float64Array;
}

function makeColumns(): ValueColumns {
  return { count: 0, x: new Float64Array(0), min: new Float64Array(0), max: new Float64Array(0) };
}

const columnBuffers: ValueColumns[] = [makeColumns(), makeColumns()];

function reduceSeries(
  values: Float64Array,
  ts: TimeScale,
  from: number,
  to: number,
  slot: 0 | 1,
): ValueColumns {
  const cols = columnBuffers[slot] as ValueColumns;
  const cap = Math.ceil(ts.width) + 4;
  if (cols.x.length < cap) {
    cols.x = new Float64Array(cap);
    cols.min = new Float64Array(cap);
    cols.max = new Float64Array(cap);
  }
  let n = 0;
  let colX = Number.NaN;
  for (let i = from; i <= to; i++) {
    const v = values[i] as number;
    if (Number.isNaN(v)) continue;
    const x = ts.xOfIndex(i);
    if (x < -1) continue;
    if (x > ts.width + 1) break;
    const px = Math.round(x);
    if (px !== colX) {
      colX = px;
      n += 1;
      if (n > cols.x.length) break;
      const k = n - 1;
      cols.x[k] = px;
      cols.min[k] = v;
      cols.max[k] = v;
      continue;
    }
    const k = n - 1;
    if (v < (cols.min[k] as number)) cols.min[k] = v;
    if (v > (cols.max[k] as number)) cols.max[k] = v;
  }
  cols.count = n;
  return cols;
}

/** Below this bar spacing an indicator series is reduced to pixel columns. */
const REDUCE_SPACING = 3;

export function drawPaneItems(
  ctx: CanvasRenderingContext2D,
  pane: Pane,
  input: IndicatorPlotInput,
): void {
  const visible = pane.items.filter((i) => i.instance.visible);
  if (visible.length === 0) return;

  // One clip for the whole pane rather than one per series: a pane with
  // Bollinger Bands, MACD and a Stochastic would otherwise install nine clip
  // regions every frame.
  const ps = pane.priceScale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, ps.top, input.timeScale.width, ps.height);
  ctx.clip();
  for (const item of visible) drawItem(ctx, ps, item, input);
  ctx.restore();
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  ps: PriceScale,
  item: PaneItem,
  input: IndicatorPlotInput,
): void {
  const { def, instance, result } = item;

  // Band fills go down first so the lines sit on top of them.
  def.outputs.forEach((spec, i) => {
    if (!spec.fillTo || !spec.fillColor) return;
    const other = def.outputs.findIndex((o) => o.key === spec.fillTo);
    if (other < 0) return;
    fillBetween(
      ctx,
      ps,
      input,
      result.outputs[i] as Float64Array,
      result.outputs[other] as Float64Array,
      spec.fillColor,
    );
  });

  def.outputs.forEach((spec, i) => {
    const values = result.outputs[i] as Float64Array;
    const color = instance.colors[spec.key] ?? spec.color;
    const width = instance.widths[spec.key] ?? spec.width;
    if (spec.style === 'volume') drawVolumeBars(ctx, ps, input, values);
    else if (spec.style === 'histogram')
      drawHistogram(ctx, ps, input, values, color, spec.negativeColor ?? color);
    else drawLineSeries(ctx, ps, input, values, color, width);
  });
}

/**
 * Indicator line: a stroked polyline when zoomed in, filled columns when not.
 *
 * Once several candles share a pixel column the line is really a band, so each
 * column becomes one filled rectangle spanning the values it covers. They are
 * drawn with `fillRect` rather than collected into a path: for exactly the
 * same pixels, a `Path2D` of thousands of rectangles measured about fifteen
 * times slower here, and a single closed polygon about five times slower.
 */
function drawLineSeries(
  ctx: CanvasRenderingContext2D,
  ps: PriceScale,
  input: IndicatorPlotInput,
  values: Float64Array,
  color: string,
  width: number,
): void {
  const { series, timeScale: ts } = input;
  const { from, to } = visibleRange(series, ts);
  if (to < from) return;

  if (ts.barSpacing < REDUCE_SPACING) {
    const cols = reduceSeries(values, ts, from, to, 0);
    const minHeight = Math.max(width, 1);
    ctx.fillStyle = color;
    for (let k = 0; k < cols.count; k++) {
      const yTop = ps.yOfPrice(cols.max[k] as number);
      const yBottom = ps.yOfPrice(cols.min[k] as number);
      ctx.fillRect(cols.x[k] as number, yTop, 1, Math.max(minHeight, yBottom - yTop));
    }
    return;
  }

  const path = new Path2D();
  let penDown = false;
  for (let i = from; i <= to; i++) {
    const v = values[i] as number;
    if (Number.isNaN(v)) {
      penDown = false;
      continue;
    }
    const x = ts.xOfIndex(i);
    if (x < -2 || x > ts.width + 2) continue;
    const y = ps.yOfPrice(v);
    if (penDown) path.lineTo(x, y);
    else {
      path.moveTo(x, y);
      penDown = true;
    }
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke(path);
}

/** Shaded region between two series, used for Bollinger Bands. */
function fillBetween(
  ctx: CanvasRenderingContext2D,
  ps: PriceScale,
  input: IndicatorPlotInput,
  upper: Float64Array,
  lower: Float64Array,
  color: string,
): void {
  const { series, timeScale: ts } = input;
  const { from, to } = visibleRange(series, ts);
  if (to < from) return;

  if (ts.barSpacing < REDUCE_SPACING) {
    const hi = reduceSeries(upper, ts, from, to, 0);
    const lo = reduceSeries(lower, ts, from, to, 1);
    const count = Math.min(hi.count, lo.count);
    ctx.fillStyle = color;
    for (let k = 0; k < count; k++) {
      const yTop = ps.yOfPrice(hi.max[k] as number);
      const yBottom = ps.yOfPrice(lo.min[k] as number);
      ctx.fillRect(hi.x[k] as number, yTop, 1, Math.max(1, yBottom - yTop));
    }
    return;
  }

  const path = new Path2D();
  let started = false;
  let runStart = -1;

  const closeRun = (end: number): void => {
    if (runStart < 0) return;
    for (let j = end; j >= runStart; j--) {
      path.lineTo(ts.xOfIndex(j), ps.yOfPrice(lower[j] as number));
    }
    path.closePath();
    runStart = -1;
    started = false;
  };

  for (let i = from; i <= to; i++) {
    const u = upper[i] as number;
    const l = lower[i] as number;
    if (Number.isNaN(u) || Number.isNaN(l)) {
      closeRun(i - 1);
      continue;
    }
    const x = ts.xOfIndex(i);
    if (!started) {
      path.moveTo(x, ps.yOfPrice(u));
      started = true;
      runStart = i;
    } else {
      path.lineTo(x, ps.yOfPrice(u));
    }
  }
  closeRun(to);

  ctx.fillStyle = color;
  ctx.fill(path);
}

/**
 * Histogram around zero.
 *
 * Four buckets when zoomed in: above or below zero picks the colour, and
 * whether the bar grew or shrank against the one before it picks the
 * intensity. That is the convention MACD readers expect — a fading green bar
 * is momentum rolling over even while the histogram is still positive.
 */
function drawHistogram(
  ctx: CanvasRenderingContext2D,
  ps: PriceScale,
  input: IndicatorPlotInput,
  values: Float64Array,
  color: string,
  negativeColor: string,
): void {
  const { series, timeScale: ts, dpr } = input;
  const { from, to } = visibleRange(series, ts);
  if (to < from) return;

  const zeroY = ps.yOfPrice(0);

  if (ts.barSpacing < REDUCE_SPACING) {
    // One bar per screen pixel, spanning that column's extremes. Two passes,
    // so the fill colour is set twice instead of once per bar.
    const cols = reduceSeries(values, ts, from, to, 0);
    ctx.fillStyle = color;
    for (let k = 0; k < cols.count; k++) {
      const hi = cols.max[k] as number;
      if (hi <= 0) continue;
      const y = ps.yOfPrice(hi);
      ctx.fillRect(cols.x[k] as number, y, 1, Math.max(1, zeroY - y));
    }
    ctx.fillStyle = negativeColor;
    for (let k = 0; k < cols.count; k++) {
      const lo = cols.min[k] as number;
      if (lo >= 0) continue;
      const y = ps.yOfPrice(lo);
      ctx.fillRect(cols.x[k] as number, zeroY, 1, Math.max(1, y - zeroY));
    }
    return;
  }

  const barWidth = Math.max(1 / dpr, Math.floor(ts.barSpacing * 0.66) || 1 / dpr);
  const posStrong = new Path2D();
  const posWeak = new Path2D();
  const negStrong = new Path2D();
  const negWeak = new Path2D();

  for (let i = from; i <= to; i++) {
    const v = values[i] as number;
    if (Number.isNaN(v)) continue;
    const x = ts.xOfIndex(i);
    if (x < -ts.barSpacing || x > ts.width + ts.barSpacing) continue;
    const y = ps.yOfPrice(v);
    const top = Math.min(y, zeroY);
    const h = Math.max(1 / dpr, Math.abs(y - zeroY));
    const prev = i > 0 ? (values[i - 1] as number) : Number.NaN;
    const growing = Number.isNaN(prev) || Math.abs(v) >= Math.abs(prev);
    const path = v >= 0 ? (growing ? posStrong : posWeak) : growing ? negStrong : negWeak;
    path.rect(x - barWidth / 2, top, barWidth, h);
  }

  ctx.save();
  ctx.fillStyle = color;
  ctx.fill(posStrong);
  ctx.fillStyle = negativeColor;
  ctx.fill(negStrong);
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = color;
  ctx.fill(posWeak);
  ctx.fillStyle = negativeColor;
  ctx.fill(negWeak);
  ctx.restore();
}

/** Volume bars coloured by the direction of the candle they belong to. */
function drawVolumeBars(
  ctx: CanvasRenderingContext2D,
  ps: PriceScale,
  input: IndicatorPlotInput,
  values: Float64Array,
): void {
  const { series, timeScale: ts, theme, dpr } = input;
  const { from, to } = visibleRange(series, ts);
  if (to < from) return;

  const base = ps.top + ps.height;
  const w = 1 / dpr;

  if (ts.barSpacing < 2.8) {
    // Below this width every bar is one pixel anyway, so per-candle colour is
    // invisible; one gradient-filled silhouette reads better and costs less.
    const cols = reduceSeries(values, ts, from, to, 0);
    const gradient = ctx.createLinearGradient(0, ps.top, 0, base);
    gradient.addColorStop(0, theme.volumeNeutral);
    gradient.addColorStop(1, theme.volumeNeutralFaded);
    ctx.fillStyle = gradient;
    for (let k = 0; k < cols.count; k++) {
      const y = ps.yOfPrice(cols.max[k] as number);
      ctx.fillRect(cols.x[k] as number, y, 1, Math.max(w, base - y));
    }
    return;
  }

  const barWidth = Math.max(w, Math.floor(ts.barSpacing * 0.72) || w);
  const up = new Path2D();
  const down = new Path2D();
  for (let i = from; i <= to; i++) {
    const x = ts.xOfIndex(i);
    if (x < -ts.barSpacing || x > ts.width + ts.barSpacing) continue;
    const y = ps.yOfPrice(values[i] as number);
    const isUp = (series.close[i] as number) >= (series.open[i] as number);
    (isUp ? up : down).rect(x - barWidth / 2, y, barWidth, Math.max(w, base - y));
  }
  ctx.fillStyle = theme.volumeUp;
  ctx.fill(up);
  ctx.fillStyle = theme.volumeDown;
  ctx.fill(down);
}

/** Dashed reference lines such as RSI's 30 and 70. */
export function drawGuides(
  ctx: CanvasRenderingContext2D,
  pane: Pane,
  input: IndicatorPlotInput,
): void {
  if (pane.guides.length === 0) return;
  const { timeScale: ts, theme, dpr } = input;
  ctx.save();
  ctx.strokeStyle = theme.gridStrong;
  ctx.lineWidth = 1 / dpr;
  ctx.setLineDash([3 / dpr, 3 / dpr]);
  ctx.beginPath();
  for (const g of pane.guides) {
    const y = crisp(pane.priceScale.yOfPrice(g), dpr);
    if (y < pane.priceScale.top || y > pane.priceScale.top + pane.priceScale.height) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(ts.width, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Extremes of every visible indicator value in a pane, for auto-scaling. */
export function paneValueRange(
  pane: Pane,
  series: CandleSeries,
  ts: TimeScale,
): { min: number; max: number } {
  const { from, to } = visibleRange(series, ts);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const item of pane.items) {
    if (!item.instance.visible) continue;
    item.def.outputs.forEach((spec, k) => {
      const values = item.result.outputs[k] as Float64Array;
      for (let i = from; i <= to; i++) {
        const v = values[i] as number;
        if (Number.isNaN(v)) continue;
        if (v > max) max = v;
        if (v < min) min = v;
      }
      // Histograms and volume bars are measured from zero, so zero has to be
      // inside the range or the bars have no baseline to stand on.
      if (spec.style !== 'line') {
        if (min > 0) min = 0;
        if (max < 0) max = 0;
      }
    });
  }
  return { min, max };
}

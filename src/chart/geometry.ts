import type { Viewport } from './viewport';
import type { PlotSeries } from './plotSeries';

/** Snap a coordinate so a 1-device-pixel line lands exactly on a pixel. */
export function crisp(v: number, dpr: number): number {
  return Math.round(v * dpr - 0.5) / dpr + 0.5 / dpr;
}

/** Visible index window, clamped to the series. */
export function visibleRange(series: PlotSeries, vp: Viewport): { from: number; to: number } {
  const from = Math.max(0, Math.floor(vp.leftIndex) - 1);
  const to = Math.min(series.length - 1, Math.ceil(vp.rightIndex) + 1);
  return { from, to };
}

/** Candles are too narrow to draw individually below this bar spacing. */
export const DENSE_SPACING = 3.5;
/**
 * Below this spacing the volume histogram collapses to a silhouette.
 *
 * Bar width is floor(spacing * 0.72), so under ~2.8px every bar is a single
 * pixel anyway — the silhouette looks identical and costs one filled path
 * instead of thousands.
 */
export const SILHOUETTE_SPACING = 2.8;

/**
 * One entry per screen pixel column, used when candles are narrower than a few
 * pixels.
 *
 * At full zoom-out a 30-day 1m chart has ~30,000 candles on screen. Reducing
 * them to pixel columns once per frame — instead of once for the auto-scale,
 * once for the candles and once for the volume — is what keeps that view at
 * 60fps. The buffers are module-level and reused so the hot path allocates
 * nothing.
 */
export interface Columns {
  count: number;
  x: Float64Array;
  high: Float64Array;
  low: Float64Array;
  open: Float64Array;
  close: Float64Array;
  volume: Float64Array;
}

const columns: Columns = {
  count: 0,
  x: new Float64Array(0),
  high: new Float64Array(0),
  low: new Float64Array(0),
  open: new Float64Array(0),
  close: new Float64Array(0),
  volume: new Float64Array(0),
};

function ensureColumns(n: number): void {
  if (columns.x.length >= n) return;
  const cap = Math.max(n, 2048);
  columns.x = new Float64Array(cap);
  columns.high = new Float64Array(cap);
  columns.low = new Float64Array(cap);
  columns.open = new Float64Array(cap);
  columns.close = new Float64Array(cap);
  columns.volume = new Float64Array(cap);
}

/** Reduce the visible candles to one entry per device-pixel column. */
export function buildColumns(series: PlotSeries, vp: Viewport, dpr: number): Columns {
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

/**
 * Auto-scale the price range to the visible candles, with padding.
 *
 * Line and area charts scale to the closing prices alone; anything that draws
 * wicks has to include the full high-low range or the extremes get clipped.
 */
export function autoScaleRange(
  series: PlotSeries,
  vp: Viewport,
  cols: Columns | null,
  closeOnly: boolean,
): void {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  if (cols) {
    for (let i = 0; i < cols.count; i++) {
      const h = closeOnly ? (cols.close[i] as number) : (cols.high[i] as number);
      const l = closeOnly ? (cols.close[i] as number) : (cols.low[i] as number);
      if (h > max) max = h;
      if (l < min) min = l;
    }
  } else {
    const { from, to } = visibleRange(series, vp);
    if (to < from) return;
    for (let i = from; i <= to; i++) {
      const h = closeOnly ? (series.close[i] as number) : (series.high[i] as number);
      const l = closeOnly ? (series.close[i] as number) : (series.low[i] as number);
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

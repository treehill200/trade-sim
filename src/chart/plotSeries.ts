import type { CandleSeries } from '@/engine/series';

/**
 * What the renderer needs from a candle source.
 *
 * `CandleSeries` satisfies this directly; derived series such as Heikin Ashi
 * produce their own arrays of the same shape, so every chart type flows
 * through one drawing path.
 */
export interface PlotSeries {
  time: Float64Array;
  open: ArrayLike<number>;
  high: ArrayLike<number>;
  low: ArrayLike<number>;
  close: ArrayLike<number>;
  volume: ArrayLike<number>;
  length: number;
}

/**
 * Heikin Ashi candles, computed once and then kept up to date incrementally.
 *
 * Each Heikin Ashi candle depends on the one before it, so the whole series
 * has to be walked from the start — doing that every frame for 43,000 candles
 * would be wasteful. Instead the cache extends itself as new candles arrive
 * and always recomputes the newest candle, which is still moving.
 */
export class HeikinAshiCache {
  private open: Float64Array = new Float64Array(0);
  private high: Float64Array = new Float64Array(0);
  private low: Float64Array = new Float64Array(0);
  private close: Float64Array = new Float64Array(0);
  private computed = 0;
  private source: CandleSeries | null = null;

  private ensure(n: number): void {
    if (this.open.length >= n) return;
    let cap = Math.max(1024, this.open.length);
    while (cap < n) cap *= 2;
    this.open = grow(this.open, cap, this.computed);
    this.high = grow(this.high, cap, this.computed);
    this.low = grow(this.low, cap, this.computed);
    this.close = grow(this.close, cap, this.computed);
  }

  /** Bring the cache in line with `series` and return it as a plot source. */
  sync(series: CandleSeries): PlotSeries {
    const n = series.length;
    this.ensure(n);

    // A new series object (timeframe switch, reload) invalidates everything.
    // So does a series that shrank, which happens when old sub-minute candles
    // are trimmed off the front.
    if (this.source !== series || this.computed > n) {
      this.source = series;
      this.computed = 0;
    }
    // The newest candle is still open, so its Heikin Ashi values are stale.
    const from = Math.max(0, Math.min(this.computed, n) - 1);

    for (let i = from; i < n; i++) {
      const o = series.open[i] as number;
      const h = series.high[i] as number;
      const l = series.low[i] as number;
      const c = series.close[i] as number;
      const haClose = (o + h + l + c) / 4;
      const haOpen =
        i === 0
          ? (o + c) / 2
          : ((this.open[i - 1] as number) + (this.close[i - 1] as number)) / 2;
      this.open[i] = haOpen;
      this.close[i] = haClose;
      this.high[i] = Math.max(h, haOpen, haClose);
      this.low[i] = Math.min(l, haOpen, haClose);
    }
    this.computed = n;

    return {
      time: series.time,
      open: this.open,
      high: this.high,
      low: this.low,
      close: this.close,
      volume: series.volume,
      length: n,
    };
  }
}

function grow(src: Float64Array, cap: number, used: number): Float64Array {
  const next = new Float64Array(cap);
  next.set(src.subarray(0, used));
  return next;
}

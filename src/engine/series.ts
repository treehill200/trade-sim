/**
 * Columnar, growable candle storage.
 *
 * Candles live in parallel typed arrays rather than an array of objects: the
 * renderer walks tens of thousands of them per frame, and columnar typed
 * arrays keep that allocation-free and cache-friendly. Prices are integer
 * cents (tick size is 0.01), so there is no float drift in OHLC values.
 */

export interface CandleView {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SeriesSnapshot {
  time: Float64Array;
  open: Int32Array;
  high: Int32Array;
  low: Int32Array;
  close: Int32Array;
  volume: Float64Array;
  length: number;
}

const MIN_CAPACITY = 1024;

export class CandleSeries {
  time: Float64Array;
  open: Int32Array;
  high: Int32Array;
  low: Int32Array;
  close: Int32Array;
  volume: Float64Array;
  length = 0;

  /** Optional cap; when exceeded the oldest candles are dropped. */
  readonly maxLength: number;

  constructor(capacity = MIN_CAPACITY, maxLength = Number.POSITIVE_INFINITY) {
    const cap = Math.max(MIN_CAPACITY, capacity);
    this.time = new Float64Array(cap);
    this.open = new Int32Array(cap);
    this.high = new Int32Array(cap);
    this.low = new Int32Array(cap);
    this.close = new Int32Array(cap);
    this.volume = new Float64Array(cap);
    this.maxLength = maxLength;
  }

  get capacity(): number {
    return this.time.length;
  }

  private ensure(n: number): void {
    if (n <= this.time.length) return;
    let cap = this.time.length;
    while (cap < n) cap *= 2;
    this.time = growF64(this.time, cap, this.length);
    this.open = growI32(this.open, cap, this.length);
    this.high = growI32(this.high, cap, this.length);
    this.low = growI32(this.low, cap, this.length);
    this.close = growI32(this.close, cap, this.length);
    this.volume = growF64(this.volume, cap, this.length);
  }

  /** Drop the oldest `n` candles, keeping the arrays compact. */
  private dropOldest(n: number): void {
    if (n <= 0) return;
    const keep = this.length - n;
    this.time.copyWithin(0, n, this.length);
    this.open.copyWithin(0, n, this.length);
    this.high.copyWithin(0, n, this.length);
    this.low.copyWithin(0, n, this.length);
    this.close.copyWithin(0, n, this.length);
    this.volume.copyWithin(0, n, this.length);
    this.length = keep;
  }

  push(time: number, open: number, high: number, low: number, close: number, volume: number): void {
    this.ensure(this.length + 1);
    const i = this.length;
    this.time[i] = time;
    this.open[i] = open;
    this.high[i] = high;
    this.low[i] = low;
    this.close[i] = close;
    this.volume[i] = volume;
    this.length = i + 1;
    if (this.length > this.maxLength) {
      this.dropOldest(this.length - this.maxLength);
    }
  }

  /** Overwrite the last candle in place (used while a candle is still open). */
  setLast(open: number, high: number, low: number, close: number, volume: number): void {
    if (this.length === 0) return;
    const i = this.length - 1;
    this.open[i] = open;
    this.high[i] = high;
    this.low[i] = low;
    this.close[i] = close;
    this.volume[i] = volume;
  }

  at(i: number): CandleView | null {
    if (i < 0 || i >= this.length) return null;
    return {
      time: this.time[i] as number,
      open: this.open[i] as number,
      high: this.high[i] as number,
      low: this.low[i] as number,
      close: this.close[i] as number,
      volume: this.volume[i] as number,
    };
  }

  lastTime(): number {
    return this.length > 0 ? (this.time[this.length - 1] as number) : Number.NaN;
  }

  lastClose(): number {
    return this.length > 0 ? (this.close[this.length - 1] as number) : Number.NaN;
  }

  /**
   * Index of the last candle whose time is <= `t`, or -1 when `t` precedes the
   * series. Binary search; candle times are strictly increasing.
   */
  indexAtOrBefore(t: number): number {
    let lo = 0;
    let hi = this.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((this.time[mid] as number) <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  /** Copy out a compact, transferable snapshot of the whole series. */
  snapshot(): SeriesSnapshot {
    const n = this.length;
    return {
      time: this.time.slice(0, n),
      open: this.open.slice(0, n),
      high: this.high.slice(0, n),
      low: this.low.slice(0, n),
      close: this.close.slice(0, n),
      volume: this.volume.slice(0, n),
      length: n,
    };
  }

  static fromSnapshot(s: SeriesSnapshot, maxLength = Number.POSITIVE_INFINITY): CandleSeries {
    const series = new CandleSeries(Math.max(MIN_CAPACITY, s.length), maxLength);
    series.time.set(s.time.subarray(0, s.length));
    series.open.set(s.open.subarray(0, s.length));
    series.high.set(s.high.subarray(0, s.length));
    series.low.set(s.low.subarray(0, s.length));
    series.close.set(s.close.subarray(0, s.length));
    series.volume.set(s.volume.subarray(0, s.length));
    series.length = s.length;
    return series;
  }
}

function growF64(src: Float64Array, cap: number, used: number): Float64Array {
  const next = new Float64Array(cap);
  next.set(src.subarray(0, used));
  return next;
}

function growI32(src: Int32Array, cap: number, used: number): Int32Array {
  const next = new Int32Array(cap);
  next.set(src.subarray(0, used));
  return next;
}

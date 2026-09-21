import { CandleSeries, type SeriesSnapshot } from './series';
import { TF_SECONDS, TIMEFRAMES, isSecondTimeframe, type Timeframe } from './timeframes';
import { SECONDS_HISTORY_MS } from './config';

/**
 * One candle series per timeframe, kept in lockstep.
 *
 * Every timeframe is aggregated directly from the same 1-second stream, so
 * "the 1m candle at 10:00" is by construction the exact combination of the
 * sixty 1s candles inside it — no timeframe can drift away from another.
 *
 * Sub-minute timeframes are capped to the most recent 24 hours; keeping 30
 * days of 1s candles would cost hundreds of megabytes for data nobody looks at.
 */
export class SeriesSet {
  readonly series: Record<Timeframe, CandleSeries>;

  /**
   * The same series, flattened into parallel arrays.
   *
   * Backfilling 30 days means running `feedSecond` 2.6 million times; looking
   * each timeframe up by string key inside that loop costs seconds of wall
   * time, so the hot path walks plain indexed arrays instead.
   */
  private readonly list: CandleSeries[] = [];
  private readonly steps: Float64Array;
  private readonly subMinute: Uint8Array;
  /** Start time of the currently open candle per timeframe, NaN when empty. */
  private readonly bucket: Float64Array;

  constructor(expectedMinutes = 50_000) {
    const series = {} as Record<Timeframe, CandleSeries>;
    this.steps = new Float64Array(TIMEFRAMES.length);
    this.subMinute = new Uint8Array(TIMEFRAMES.length);
    this.bucket = new Float64Array(TIMEFRAMES.length).fill(Number.NaN);

    TIMEFRAMES.forEach((tf, i) => {
      const seconds = TF_SECONDS[tf];
      let s: CandleSeries;
      if (isSecondTimeframe(tf)) {
        const cap = Math.ceil(SECONDS_HISTORY_MS / 1000 / seconds) + 8;
        s = new CandleSeries(cap, cap);
      } else {
        const cap = Math.max(1024, Math.ceil((expectedMinutes * 60) / seconds) + 8);
        s = new CandleSeries(cap);
      }
      series[tf] = s;
      this.list[i] = s;
      this.steps[i] = seconds * 1000;
      this.subMinute[i] = isSecondTimeframe(tf) ? 1 : 0;
    });
    this.series = series;
  }

  get(tf: Timeframe): CandleSeries {
    return this.series[tf];
  }

  /** Re-point the flattened arrays after a series is swapped out. */
  rebind(tf: Timeframe, series: CandleSeries): void {
    const i = TIMEFRAMES.indexOf(tf);
    this.series[tf] = series;
    this.list[i] = series;
    this.bucket[i] = series.lastTime();
  }

  /**
   * Merge one finished 1-second candle into every timeframe.
   *
   * `secondsCutoff` is the oldest timestamp for which sub-minute timeframes
   * are still built; older seconds only feed 1m and above.
   */
  feedSecond(
    time: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
    secondsCutoff: number,
  ): void {
    const n = this.list.length;
    for (let k = 0; k < n; k++) {
      if (this.subMinute[k] === 1 && time < secondsCutoff) continue;
      const step = this.steps[k] as number;
      const start = time - (time % step);
      const s = this.list[k] as CandleSeries;
      if (this.bucket[k] !== start || s.length === 0) {
        s.push(start, open, high, low, close, volume);
        this.bucket[k] = start;
      } else {
        const i = s.length - 1;
        if (high > (s.high[i] as number)) s.high[i] = high;
        if (low < (s.low[i] as number)) s.low[i] = low;
        s.close[i] = close;
        s.volume[i] = (s.volume[i] as number) + volume;
      }
    }
  }

  /**
   * Merge a single live print into every timeframe.
   *
   * Used while a second is still in progress, so the chart moves between
   * whole seconds. Feeding the finished 1s candle afterwards is a no-op in
   * aggregate terms because the same prints have already been merged.
   */
  applyTick(time: number, price: number, volume: number, secondsCutoff: number): void {
    const n = this.list.length;
    for (let k = 0; k < n; k++) {
      if (this.subMinute[k] === 1 && time < secondsCutoff) continue;
      const step = this.steps[k] as number;
      const start = time - (time % step);
      const s = this.list[k] as CandleSeries;
      if (this.bucket[k] !== start || s.length === 0) {
        s.push(start, price, price, price, price, volume);
        this.bucket[k] = start;
      } else {
        const i = s.length - 1;
        if (price > (s.high[i] as number)) s.high[i] = price;
        if (price < (s.low[i] as number)) s.low[i] = price;
        s.close[i] = price;
        s.volume[i] = (s.volume[i] as number) + volume;
      }
    }
  }

  snapshotAll(): Record<Timeframe, SeriesSnapshot> {
    const out = {} as Record<Timeframe, SeriesSnapshot>;
    for (const tf of TIMEFRAMES) out[tf] = this.series[tf].snapshot();
    return out;
  }

  static fromSnapshots(snaps: Record<Timeframe, SeriesSnapshot>): SeriesSet {
    const set = new SeriesSet();
    for (const tf of TIMEFRAMES) {
      const snap = snaps[tf];
      if (!snap) continue;
      const maxLength = isSecondTimeframe(tf)
        ? Math.ceil(SECONDS_HISTORY_MS / 1000 / TF_SECONDS[tf]) + 8
        : Number.POSITIVE_INFINITY;
      set.rebind(tf, CandleSeries.fromSnapshot(snap, maxLength));
    }
    return set;
  }
}

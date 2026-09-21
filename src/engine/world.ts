import { MarketSimulator, makeSecondResult, type SecondResult, type SimState } from './simulator';
import { SeriesSet } from './seriesSet';
import { SECONDS_HISTORY_MS, type MarketConfig } from './config';
import { buildOrderBook, type OrderBook } from './orderbook';
import { TIMEFRAMES, isSecondTimeframe } from './timeframes';
import { CandleSeries } from './series';

export interface Quote {
  time: number;
  /** Last traded price, in cents. */
  last: number;
  bid: number;
  ask: number;
  spread: number;
  volFactor: number;
}

/**
 * The simulated world: a simulator plus the candle series it feeds.
 *
 * `catchUp` walks simulated seconds until the world reaches wall-clock time —
 * that is what backfills history on first launch and what fills the gap after
 * the tab has been closed for a while. `revealTick` then drips out the
 * sub-second prints of the current second so the live candle animates.
 */
export class World {
  readonly config: MarketConfig;
  readonly series: SeriesSet;
  private sim: MarketSimulator;
  private scratch: SecondResult;

  /** The second currently being revealed tick by tick. */
  private pending: {
    time: number;
    prices: Int32Array;
    volumes: Float64Array;
    halfSpread: number;
    volFactor: number;
  } | null = null;
  private revealed = 0;

  private lastQuote: Quote;

  constructor(config: MarketConfig, restore?: { state: SimState; series: SeriesSet }) {
    this.config = config;
    this.sim = new MarketSimulator(config, restore?.state);
    this.series = restore?.series ?? new SeriesSet();
    this.scratch = makeSecondResult(config.subTicksPerSecond);
    const px = this.sim.priceCents;
    this.lastQuote = { time: this.sim.nextTime, last: px, bid: px, ask: px, spread: 0, volFactor: 1 };
  }

  get quote(): Quote {
    return this.lastQuote;
  }

  checkpoint(): SimState {
    return this.sim.checkpoint();
  }

  /** Number of simulated seconds still needed to reach `targetMs`. */
  secondsBehind(targetMs: number): number {
    return Math.max(0, Math.floor((targetMs - this.sim.nextTime) / 1000));
  }

  /**
   * If the world has been away longer than we keep sub-minute history, the
   * existing seconds series describe a window that no longer touches the
   * present. Drop them so they refill cleanly rather than showing a gap.
   */
  resetSecondSeriesIfStale(targetMs: number): void {
    const last = this.series.get('1s').lastTime();
    if (Number.isNaN(last)) return;
    if (targetMs - last <= SECONDS_HISTORY_MS) return;
    for (const tf of TIMEFRAMES) {
      if (isSecondTimeframe(tf)) {
        this.series.rebind(tf, new CandleSeries(1024, this.series.get(tf).maxLength));
      }
    }
  }

  /**
   * Walk forward at most `maxSeconds` simulated seconds toward `targetMs`.
   * Returns how many seconds were actually produced, so the caller can drive a
   * progress bar and yield to the event loop between chunks.
   */
  catchUpChunk(targetMs: number, maxSeconds: number): number {
    const cutoff = targetMs - SECONDS_HISTORY_MS;
    let produced = 0;
    while (produced < maxSeconds && this.sim.nextTime + 1000 <= targetMs) {
      const r = this.sim.stepSecond(this.scratch);
      this.series.feedSecond(r.time, r.open, r.high, r.low, r.close, r.volume, cutoff);
      produced += 1;
    }
    if (produced > 0) {
      const r = this.scratch;
      this.lastQuote = {
        time: r.time + 1000,
        last: r.close,
        bid: r.close - r.halfSpreadCents,
        ask: r.close + r.halfSpreadCents,
        spread: r.halfSpreadCents * 2,
        volFactor: r.volFactor,
      };
    }
    return produced;
  }

  /** True once the world has produced every whole second up to `targetMs`. */
  isCaughtUp(targetMs: number): boolean {
    return this.sim.nextTime + 1000 > targetMs;
  }

  /**
   * Reveal any sub-second prints that should have happened by `nowMs`.
   *
   * The simulator always runs one second ahead internally; this hands out that
   * second's prints at the wall-clock moment each of them "occurs".
   */
  revealTick(nowMs: number): Quote | null {
    const n = this.config.subTicksPerSecond;
    const stepMs = 1000 / n;
    let changed = false;

    for (let guard = 0; guard < 8; guard++) {
      if (!this.pending) {
        if (this.sim.nextTime > nowMs) break;
        const r = this.sim.stepSecond(this.scratch);
        this.pending = {
          time: r.time,
          prices: Int32Array.from(r.subPrices),
          volumes: Float64Array.from(r.subVolumes),
          halfSpread: r.halfSpreadCents,
          volFactor: r.volFactor,
        };
        this.revealed = 0;
      }
      const p = this.pending;
      const cutoff = nowMs - SECONDS_HISTORY_MS;
      let advanced = false;
      while (this.revealed < n && p.time + (this.revealed + 1) * stepMs <= nowMs) {
        const idx = this.revealed;
        const price = p.prices[idx] as number;
        const vol = p.volumes[idx] as number;
        this.series.applyTick(p.time + idx * stepMs, price, vol, cutoff);
        this.revealed += 1;
        advanced = true;
        changed = true;
      }
      if (this.revealed >= n) {
        this.lastQuote = {
          time: p.time + 1000,
          last: p.prices[n - 1] as number,
          bid: (p.prices[n - 1] as number) - p.halfSpread,
          ask: (p.prices[n - 1] as number) + p.halfSpread,
          spread: p.halfSpread * 2,
          volFactor: p.volFactor,
        };
        this.pending = null;
        continue;
      }
      if (advanced) {
        const price = p.prices[this.revealed - 1] as number;
        this.lastQuote = {
          time: p.time + this.revealed * stepMs,
          last: price,
          bid: price - p.halfSpread,
          ask: price + p.halfSpread,
          spread: p.halfSpread * 2,
          volFactor: p.volFactor,
        };
      }
      break;
    }

    return changed ? this.lastQuote : null;
  }

  book(levels: number): OrderBook {
    const q = this.lastQuote;
    const half = Math.max(1, Math.round(q.spread / 2));
    return buildOrderBook(
      q.last,
      half,
      q.volFactor,
      levels,
      Math.floor(q.time / 700),
      this.config.tickSizeCents,
    );
  }
}

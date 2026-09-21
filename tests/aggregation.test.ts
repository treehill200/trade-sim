import { describe, expect, it } from 'vitest';
import { SeriesSet } from '@/engine/seriesSet';
import { MarketSimulator, makeSecondResult } from '@/engine/simulator';
import { TF_SECONDS, TIMEFRAMES, type Timeframe } from '@/engine/timeframes';
import type { MarketConfig } from '@/engine/config';
import { DEFAULT_START_PRICE_CENTS } from '@/engine/config';

const GENESIS = Date.UTC(2025, 3, 10, 0, 0, 0);

const config: MarketConfig = {
  symbol: 'DAVID/USD',
  name: 'David Coin',
  seed: 24680,
  genesisMs: GENESIS,
  startPriceCents: DEFAULT_START_PRICE_CENTS,
  tickSizeCents: 1,
  subTicksPerSecond: 4,
};

/** Build a set from `seconds` of simulated market, keeping every timeframe. */
function build(seconds: number): SeriesSet {
  const set = new SeriesSet();
  const sim = new MarketSimulator(config);
  const r = makeSecondResult(4);
  for (let i = 0; i < seconds; i++) {
    sim.stepSecond(r);
    set.feedSecond(r.time, r.open, r.high, r.low, r.close, r.volume, 0);
  }
  return set;
}

/** Re-aggregate `target` from `source` by hand and compare against the set. */
function expectExactAggregation(set: SeriesSet, source: Timeframe, target: Timeframe): void {
  const src = set.get(source);
  const dst = set.get(target);
  const step = TF_SECONDS[target] * 1000;

  let di = 0;
  let si = 0;
  while (di < dst.length && si < src.length) {
    const start = dst.time[di] as number;
    if ((src.time[si] as number) < start) {
      si += 1;
      continue;
    }
    let open = Number.NaN;
    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    let close = Number.NaN;
    let volume = 0;
    let count = 0;
    while (si < src.length && (src.time[si] as number) < start + step) {
      if (count === 0) open = src.open[si] as number;
      high = Math.max(high, src.high[si] as number);
      low = Math.min(low, src.low[si] as number);
      close = src.close[si] as number;
      volume += src.volume[si] as number;
      count += 1;
      si += 1;
    }
    if (count > 0) {
      expect(dst.open[di]).toBe(open);
      expect(dst.high[di]).toBe(high);
      expect(dst.low[di]).toBe(low);
      expect(dst.close[di]).toBe(close);
      expect(dst.volume[di] as number).toBeCloseTo(volume, 6);
    }
    di += 1;
  }
  expect(di).toBeGreaterThan(2);
}

describe('timeframe aggregation', () => {
  const set = build(3 * 3600); // three hours of market

  it('bucket start times are aligned to the timeframe', () => {
    for (const tf of TIMEFRAMES) {
      const s = set.get(tf);
      const step = TF_SECONDS[tf] * 1000;
      for (let i = 0; i < s.length; i++) {
        expect((s.time[i] as number) % step).toBe(0);
      }
    }
  });

  it('1m is an exact aggregation of 1s', () => {
    expectExactAggregation(set, '1s', '1m');
  });

  it('5m is an exact aggregation of 1m', () => {
    expectExactAggregation(set, '1m', '5m');
  });

  it('1h is an exact aggregation of 5m', () => {
    expectExactAggregation(set, '5m', '1h');
  });

  it('30s is an exact aggregation of 5s', () => {
    expectExactAggregation(set, '5s', '30s');
  });

  it('candle times strictly increase on every timeframe', () => {
    for (const tf of TIMEFRAMES) {
      const s = set.get(tf);
      for (let i = 1; i < s.length; i++) {
        expect(s.time[i] as number).toBeGreaterThan(s.time[i - 1] as number);
      }
    }
  });

  it('leaves no gaps in a 24/7 market', () => {
    for (const tf of TIMEFRAMES) {
      const s = set.get(tf);
      if (s.length < 3) continue;
      const step = TF_SECONDS[tf] * 1000;
      for (let i = 1; i < s.length; i++) {
        expect((s.time[i] as number) - (s.time[i - 1] as number)).toBe(step);
      }
    }
  });
});

describe('seconds history window', () => {
  it('drops sub-minute candles older than the cutoff', () => {
    const set = new SeriesSet();
    const sim = new MarketSimulator(config);
    const r = makeSecondResult(4);
    const seconds = 2000;
    const cutoff = GENESIS + 1000 * 1000; // keep only the second half
    for (let i = 0; i < seconds; i++) {
      sim.stepSecond(r);
      set.feedSecond(r.time, r.open, r.high, r.low, r.close, r.volume, cutoff);
    }
    expect(set.get('1s').length).toBe(1000);
    expect(set.get('1s').time[0]).toBe(cutoff);
    // Minute candles are unaffected by the sub-minute cutoff.
    expect(set.get('1m').length).toBeGreaterThan(30);
  });
});

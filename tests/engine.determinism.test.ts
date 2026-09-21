import { describe, expect, it } from 'vitest';
import { MarketSimulator, makeSecondResult, seasonalVol } from '@/engine/simulator';
import type { MarketConfig } from '@/engine/config';
import { DEFAULT_START_PRICE_CENTS } from '@/engine/config';

const GENESIS = Date.UTC(2025, 0, 1, 0, 0, 0);

function cfg(seed = 12345): MarketConfig {
  return {
    symbol: 'DAVID/USD',
    name: 'David Coin',
    seed,
    genesisMs: GENESIS,
    startPriceCents: DEFAULT_START_PRICE_CENTS,
    tickSizeCents: 1,
    subTicksPerSecond: 4,
  };
}

function walk(sim: MarketSimulator, seconds: number): number[] {
  const out: number[] = [];
  const r = makeSecondResult(4);
  for (let i = 0; i < seconds; i++) {
    sim.stepSecond(r);
    out.push(r.close);
  }
  return out;
}

describe('market simulator determinism', () => {
  it('produces identical history for the same seed', () => {
    const a = walk(new MarketSimulator(cfg()), 5000);
    const b = walk(new MarketSimulator(cfg()), 5000);
    expect(b).toEqual(a);
  });

  it('produces different history for a different seed', () => {
    const a = walk(new MarketSimulator(cfg(1)), 2000);
    const b = walk(new MarketSimulator(cfg(2)), 2000);
    expect(b).not.toEqual(a);
  });

  it('resumes bit-identically from a checkpoint', () => {
    const full = new MarketSimulator(cfg());
    const expected = walk(full, 4000);

    const partial = new MarketSimulator(cfg());
    walk(partial, 1500);
    const resumed = new MarketSimulator(cfg(), partial.checkpoint());
    const tail = walk(resumed, 2500);

    expect(tail).toEqual(expected.slice(1500));
  });
});

describe('candle integrity', () => {
  it('keeps high >= max(open, close) and low <= min(open, close)', () => {
    const sim = new MarketSimulator(cfg(777));
    const r = makeSecondResult(4);
    for (let i = 0; i < 20000; i++) {
      sim.stepSecond(r);
      expect(r.high).toBeGreaterThanOrEqual(Math.max(r.open, r.close));
      expect(r.low).toBeLessThanOrEqual(Math.min(r.open, r.close));
      expect(r.volume).toBeGreaterThan(0);
      expect(Number.isInteger(r.close)).toBe(true);
    }
  });

  it('opens each second at the previous second close', () => {
    const sim = new MarketSimulator(cfg(9));
    const r = makeSecondResult(4);
    sim.stepSecond(r);
    let prevClose = r.close;
    for (let i = 0; i < 5000; i++) {
      sim.stepSecond(r);
      expect(r.open).toBe(prevClose);
      prevClose = r.close;
    }
  });

  it('advances one second of wall-clock time per step', () => {
    const sim = new MarketSimulator(cfg());
    const r = makeSecondResult(4);
    sim.stepSecond(r);
    const first = r.time;
    sim.stepSecond(r);
    expect(r.time - first).toBe(1000);
  });
});

describe('volatility seasonality', () => {
  it('peaks in the 13:00-16:00 UTC window', () => {
    const quiet = seasonalVol(Date.UTC(2025, 0, 1, 4, 0, 0));
    const busy = seasonalVol(Date.UTC(2025, 0, 1, 14, 30, 0));
    expect(busy).toBeGreaterThan(quiet * 1.5);
  });

  it('is continuous across the midnight boundary', () => {
    const before = seasonalVol(Date.UTC(2025, 0, 1, 23, 59, 30));
    const after = seasonalVol(Date.UTC(2025, 0, 2, 0, 0, 30));
    expect(Math.abs(after - before)).toBeLessThan(0.05);
  });
});

describe('price behaviour', () => {
  it('stays in a plausible band and keeps a crypto-like volatility', () => {
    const sim = new MarketSimulator(cfg(4242));
    const r = makeSecondResult(4);
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    let prevDayClose = DEFAULT_START_PRICE_CENTS;
    const dailyReturns: number[] = [];

    const days = 30;
    for (let d = 0; d < days; d++) {
      for (let i = 0; i < 86400; i++) {
        sim.stepSecond(r);
        if (r.close < min) min = r.close;
        if (r.close > max) max = r.close;
      }
      dailyReturns.push(Math.log(r.close / prevDayClose));
      prevDayClose = r.close;
    }

    // A volatile asset over a month should move a lot, but not by 4x.
    expect(min).toBeGreaterThan(DEFAULT_START_PRICE_CENTS / 4);
    expect(max).toBeLessThan(DEFAULT_START_PRICE_CENTS * 4);

    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (dailyReturns.length - 1);
    const annualised = Math.sqrt(variance) * Math.sqrt(365);
    // Roughly where a liquid crypto pair actually trades. The band is wide
    // because it is one sample path, but it will catch a tuning mistake that
    // turns the market into a flatline or a rocket.
    expect(annualised).toBeGreaterThan(0.45);
    expect(annualised).toBeLessThan(1.8);
  }, 60_000);
});

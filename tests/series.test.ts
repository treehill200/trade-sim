import { describe, expect, it } from 'vitest';
import { CandleSeries } from '@/engine/series';
import { floorToTf, TF_SECONDS, TIMEFRAMES } from '@/engine/timeframes';
import { niceStep, formatCents, formatCountdown, formatPercent } from '@/chart/format';
import { PriceScale, TimeScale } from '@/chart/scales';

describe('CandleSeries', () => {
  it('grows past its initial capacity', () => {
    const s = new CandleSeries(8);
    for (let i = 0; i < 5000; i++) s.push(i * 1000, 100, 110, 90, 105, 1);
    expect(s.length).toBe(5000);
    expect(s.at(4999)?.time).toBe(4999 * 1000);
  });

  it('drops the oldest candles once maxLength is reached', () => {
    const s = new CandleSeries(8, 100);
    for (let i = 0; i < 500; i++) s.push(i * 1000, 1, 1, 1, 1, 1);
    expect(s.length).toBe(100);
    expect(s.at(0)?.time).toBe(400 * 1000);
    expect(s.at(99)?.time).toBe(499 * 1000);
  });

  it('finds the candle at or before a timestamp', () => {
    const s = new CandleSeries();
    for (let i = 0; i < 100; i++) s.push(i * 1000, 1, 1, 1, 1, 1);
    expect(s.indexAtOrBefore(-1)).toBe(-1);
    expect(s.indexAtOrBefore(0)).toBe(0);
    expect(s.indexAtOrBefore(10_500)).toBe(10);
    expect(s.indexAtOrBefore(99_999)).toBe(99);
  });

  it('round-trips through a snapshot', () => {
    const s = new CandleSeries();
    for (let i = 0; i < 50; i++) s.push(i * 1000, i, i + 5, i - 5, i + 1, i * 2);
    const copy = CandleSeries.fromSnapshot(s.snapshot());
    expect(copy.length).toBe(50);
    expect(copy.at(17)).toEqual(s.at(17));
  });
});

describe('timeframes', () => {
  it('every timeframe divides a day evenly', () => {
    for (const tf of TIMEFRAMES) {
      expect(86400 % TF_SECONDS[tf]).toBe(0);
    }
  });

  it('floors timestamps to the start of the candle', () => {
    const t = Date.UTC(2025, 5, 4, 13, 47, 29);
    expect(floorToTf(t, '1m')).toBe(Date.UTC(2025, 5, 4, 13, 47, 0));
    expect(floorToTf(t, '15m')).toBe(Date.UTC(2025, 5, 4, 13, 45, 0));
    expect(floorToTf(t, '4h')).toBe(Date.UTC(2025, 5, 4, 12, 0, 0));
    expect(floorToTf(t, '1D')).toBe(Date.UTC(2025, 5, 4, 0, 0, 0));
  });
});

describe('formatting', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(4_012_345)).toBe('40,123.45');
    expect(formatCents(1)).toBe('0.01');
  });

  it('formats percentages with an explicit sign', () => {
    expect(formatPercent(0.0125)).toBe('+1.25%');
    expect(formatPercent(-0.0125)).toBe('-1.25%');
    expect(formatPercent(0)).toBe('0.00%');
  });

  it('formats a countdown', () => {
    expect(formatCountdown(168_000)).toBe('02:48');
    expect(formatCountdown(-5)).toBe('00:00');
    expect(formatCountdown(3_661_000)).toBe('01:01:01');
  });

  it('picks round axis steps', () => {
    expect(niceStep(17, 1)).toBe(20);
    expect(niceStep(2.2, 1)).toBe(2.5);
    expect(niceStep(0.3, 1)).toBe(1);
    expect(niceStep(430, 1)).toBe(500);
  });
});

describe('TimeScale', () => {
  it('maps bar indices to pixels and back', () => {
    const ts = new TimeScale();
    ts.width = 800;
    ts.barSpacing = 8;
    ts.rightIndex = 100;
    expect(ts.xOfIndex(100)).toBe(800);
    expect(ts.xOfIndex(0)).toBe(0);
    expect(ts.indexOfX(400)).toBeCloseTo(50);
  });

  it('keeps the anchored bar under the cursor while zooming', () => {
    const ts = new TimeScale();
    ts.width = 800;
    ts.barSpacing = 8;
    ts.rightIndex = 100;
    const anchorX = 320;
    const before = ts.indexOfX(anchorX);
    ts.zoomAt(anchorX, 1.5);
    expect(ts.indexOfX(anchorX)).toBeCloseTo(before, 6);
  });
});

describe('PriceScale', () => {
  it('maps values to pixels on both linear and log axes', () => {
    const ps = new PriceScale();
    ps.top = 0;
    ps.height = 400;
    ps.range = { min: 100, max: 200 };
    expect(ps.yOfPrice(200)).toBeCloseTo(0);
    expect(ps.yOfPrice(100)).toBeCloseTo(400);
    expect(ps.priceOfY(200)).toBeCloseTo(150);

    ps.logScale = true;
    expect(ps.yOfPrice(200)).toBeCloseTo(0);
    expect(ps.yOfPrice(100)).toBeCloseTo(400);
    // The midpoint of a log axis is the geometric mean, not the average.
    expect(ps.priceOfY(200)).toBeCloseTo(Math.sqrt(100 * 200));
  });

  it('offsets by the pane top edge', () => {
    const ps = new PriceScale();
    ps.top = 500;
    ps.height = 200;
    ps.range = { min: 0, max: 100 };
    expect(ps.yOfPrice(100)).toBeCloseTo(500);
    expect(ps.yOfPrice(0)).toBeCloseTo(700);
    expect(ps.priceOfY(600)).toBeCloseTo(50);
    expect(ps.contains(600)).toBe(true);
    expect(ps.contains(400)).toBe(false);
  });
});

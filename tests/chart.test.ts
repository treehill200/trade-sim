import { describe, expect, it } from 'vitest';
import { CandleSeries } from '@/engine/series';
import { HeikinAshiCache } from '@/chart/plotSeries';
import { CHART_TYPES, isCloseOnly, parseChartType } from '@/chart/chartTypes';
import { Viewport } from '@/chart/viewport';

function seriesOf(rows: [number, number, number, number][]): CandleSeries {
  const s = new CandleSeries();
  rows.forEach((r, i) => s.push(i * 60_000, r[0], r[1], r[2], r[3], 1));
  return s;
}

/** Reference implementation, straight from the Heikin Ashi definition. */
function heikinAshiReference(s: CandleSeries): { o: number[]; h: number[]; l: number[]; c: number[] } {
  const o: number[] = [];
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const open = s.open[i] as number;
    const high = s.high[i] as number;
    const low = s.low[i] as number;
    const close = s.close[i] as number;
    const haClose = (open + high + low + close) / 4;
    const haOpen = i === 0 ? (open + close) / 2 : ((o[i - 1] as number) + (c[i - 1] as number)) / 2;
    o.push(haOpen);
    c.push(haClose);
    h.push(Math.max(high, haOpen, haClose));
    l.push(Math.min(low, haOpen, haClose));
  }
  return { o, h, l, c };
}

describe('Heikin Ashi', () => {
  const rows: [number, number, number, number][] = [
    [100, 110, 95, 105],
    [105, 120, 100, 118],
    [118, 125, 112, 114],
    [114, 116, 100, 102],
    [102, 108, 98, 107],
    [107, 130, 106, 129],
  ];

  it('matches the definition', () => {
    const s = seriesOf(rows);
    const ha = new HeikinAshiCache().sync(s);
    const ref = heikinAshiReference(s);
    for (let i = 0; i < s.length; i++) {
      expect(ha.open[i]).toBeCloseTo(ref.o[i] as number, 9);
      expect(ha.high[i]).toBeCloseTo(ref.h[i] as number, 9);
      expect(ha.low[i]).toBeCloseTo(ref.l[i] as number, 9);
      expect(ha.close[i]).toBeCloseTo(ref.c[i] as number, 9);
    }
  });

  it('keeps high and low around the body', () => {
    const ha = new HeikinAshiCache().sync(seriesOf(rows));
    for (let i = 0; i < ha.length; i++) {
      const o = ha.open[i] as number;
      const c = ha.close[i] as number;
      expect(ha.high[i] as number).toBeGreaterThanOrEqual(Math.max(o, c));
      expect(ha.low[i] as number).toBeLessThanOrEqual(Math.min(o, c));
    }
  });

  it('extending incrementally gives the same answer as computing from scratch', () => {
    const cache = new HeikinAshiCache();
    const s = new CandleSeries();
    // Feed candles one at a time, re-syncing after each, as the live chart does.
    rows.forEach((r, i) => {
      s.push(i * 60_000, r[0], r[1], r[2], r[3], 1);
      cache.sync(s);
    });
    const incremental = cache.sync(s);
    const fresh = new HeikinAshiCache().sync(s);
    for (let i = 0; i < s.length; i++) {
      expect(incremental.open[i]).toBeCloseTo(fresh.open[i] as number, 9);
      expect(incremental.close[i]).toBeCloseTo(fresh.close[i] as number, 9);
    }
  });

  it('recomputes the newest candle while it is still moving', () => {
    const cache = new HeikinAshiCache();
    const s = seriesOf(rows);
    cache.sync(s);
    // The live candle closes higher; its Heikin Ashi close must follow.
    s.setLast(107, 140, 106, 139, 2);
    const ha = cache.sync(s);
    const last = s.length - 1;
    expect(ha.close[last]).toBeCloseTo((107 + 140 + 106 + 139) / 4, 9);
  });

  it('starts over when the series is replaced', () => {
    const cache = new HeikinAshiCache();
    cache.sync(seriesOf(rows));
    const other = seriesOf([[500, 510, 490, 505]]);
    const ha = cache.sync(other);
    expect(ha.length).toBe(1);
    expect(ha.open[0]).toBeCloseTo((500 + 505) / 2, 9);
  });
});

describe('chart types', () => {
  it('parses known names and rejects others', () => {
    for (const t of CHART_TYPES) expect(parseChartType(t)).toBe(t);
    expect(parseChartType('pie')).toBeNull();
  });

  it('treats only line and area as close-only', () => {
    expect(isCloseOnly('line')).toBe(true);
    expect(isCloseOnly('area')).toBe(true);
    expect(isCloseOnly('candles')).toBe(false);
    expect(isCloseOnly('heikin')).toBe(false);
  });
});

describe('viewport scroll clamping', () => {
  function vpWith(len: number): Viewport {
    const vp = new Viewport();
    vp.width = 800;
    vp.height = 400;
    vp.barSpacing = 8;
    vp.rightIndex = len - 1;
    return vp;
  }

  it('limits how much empty space can sit to the right', () => {
    const vp = vpWith(1000);
    vp.rightIndex = 100_000;
    vp.clampScroll(1000);
    const marginPx = (vp.rightIndex - 999) * vp.barSpacing;
    expect(marginPx).toBeCloseTo(vp.maxRightMarginPx());
  });

  it('keeps candles on screen when scrolled far back', () => {
    const vp = vpWith(1000);
    vp.rightIndex = -5000;
    vp.clampScroll(1000);
    expect(vp.rightIndex).toBe(10);
  });

  it('does nothing on an empty series', () => {
    const vp = vpWith(0);
    vp.rightIndex = 42;
    vp.clampScroll(0);
    expect(vp.rightIndex).toBe(42);
  });
});

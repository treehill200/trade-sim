import { describe, expect, it } from 'vitest';
import { CandleSeries } from '@/engine/series';
import { ema, rma, rollingMax, rollingMin, rollingStdev, sma } from '@/indicators/math';
import { INDICATOR_DEFS, indicatorDef } from '@/indicators/defs';
import { defaultParams } from '@/indicators/types';
import { useUi } from '@/state/store';

function run(
  fn: (src: ArrayLike<number>, length: number, n: number, out: Float64Array) => void,
  src: number[],
  length: number,
): number[] {
  const out = new Float64Array(src.length);
  fn(src, length, src.length, out);
  return [...out];
}

describe('moving averages', () => {
  it('SMA warms up then averages the window', () => {
    const r = run(sma, [1, 2, 3, 4, 5, 6], 3);
    expect(r.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(r.slice(2)).toEqual([2, 3, 4, 5]);
  });

  it('SMA restarts after a gap instead of poisoning the running sum', () => {
    // A NaN in the middle is exactly what a chained indicator produces, and a
    // naive running sum would return NaN for every value after it.
    const r = run(sma, [1, 2, 3, Number.NaN, 5, 6, 7, 8], 3);
    expect(Number.isNaN(r[3] as number)).toBe(true);
    expect(Number.isNaN(r[4] as number)).toBe(true);
    expect(Number.isNaN(r[5] as number)).toBe(true);
    expect(r[6]).toBe(6);
    expect(r[7]).toBe(7);
  });

  it('EMA seeds from the simple average of the first window', () => {
    const r = run(ema, [1, 2, 3, 4, 5], 3);
    expect(Number.isNaN(r[1] as number)).toBe(true);
    expect(r[2]).toBe(2); // (1 + 2 + 3) / 3
    const k = 2 / 4;
    expect(r[3]).toBeCloseTo(4 * k + 2 * (1 - k), 10);
  });

  it("RMA smooths with Wilder's 1/length factor, not the EMA factor", () => {
    const r = run(rma, [1, 2, 3, 4, 5], 3);
    expect(r[2]).toBe(2);
    expect(r[3]).toBeCloseTo((2 * 2 + 4) / 3, 10);
  });

  it('rolling standard deviation matches the direct calculation', () => {
    const src = [4, 8, 15, 16, 23, 42];
    const r = run(rollingStdev, src, 3);
    const window = src.slice(3, 6);
    const mean = window.reduce((a, b) => a + b, 0) / 3;
    const expected = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / 3);
    expect(r[5]).toBeCloseTo(expected, 10);
  });
});

describe('rolling extremes', () => {
  const src = [5, 1, 9, 3, 7, 2, 8, 4];

  it('rolling max matches a brute-force scan', () => {
    const r = run(rollingMax, src, 3);
    for (let i = 2; i < src.length; i++) {
      expect(r[i]).toBe(Math.max(...src.slice(i - 2, i + 1)));
    }
  });

  it('rolling min matches a brute-force scan', () => {
    const r = run(rollingMin, src, 3);
    for (let i = 2; i < src.length; i++) {
      expect(r[i]).toBe(Math.min(...src.slice(i - 2, i + 1)));
    }
  });
});

/** A deterministic wavy series, so indicator values are reproducible. */
function sampleSeries(n = 300): CandleSeries {
  const s = new CandleSeries();
  let price = 10_000;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 11) * 60 + Math.cos(i / 4) * 25;
    const open = Math.round(price);
    price = price + drift;
    const close = Math.round(price);
    const high = Math.max(open, close) + 30;
    const low = Math.min(open, close) - 30;
    s.push(Date.UTC(2025, 0, 1) + i * 60_000, open, high, low, close, 10 + (i % 7));
  }
  return s;
}

function computeAll(defId: string): { def: ReturnType<typeof indicatorDef>; outputs: Float64Array[]; series: CandleSeries } {
  const def = indicatorDef(defId);
  if (!def) throw new Error(`missing ${defId}`);
  const series = sampleSeries();
  const outputs = def.outputs.map(() => new Float64Array(series.length));
  def.compute(series, defaultParams(def), outputs);
  return { def, outputs, series };
}

describe('indicator catalogue', () => {
  it('every indicator produces finite values once warmed up', () => {
    for (const def of INDICATOR_DEFS) {
      const { outputs, series } = computeAll(def.id);
      outputs.forEach((values, k) => {
        const tail = [...values.subarray(series.length - 20, series.length)];
        const label = `${def.id}.${def.outputs[k]?.key}`;
        expect(tail.every((v) => Number.isFinite(v)), `${label} has non-finite tail`).toBe(true);
      });
    }
  });

  it('RSI stays within 0 and 100', () => {
    const { outputs, series } = computeAll('rsi');
    const values = outputs[0] as Float64Array;
    for (let i = 0; i < series.length; i++) {
      const v = values[i] as number;
      if (Number.isNaN(v)) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('Stochastic stays within 0 and 100', () => {
    const { outputs, series } = computeAll('stoch');
    for (const values of outputs) {
      for (let i = 0; i < series.length; i++) {
        const v = values[i] as number;
        if (Number.isNaN(v)) continue;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('Bollinger bands bracket the basis', () => {
    const { outputs, series } = computeAll('bb');
    const [upper, basis, lower] = outputs as [Float64Array, Float64Array, Float64Array];
    for (let i = 0; i < series.length; i++) {
      if (Number.isNaN(basis[i] as number)) continue;
      expect(upper[i] as number).toBeGreaterThanOrEqual(basis[i] as number);
      expect(lower[i] as number).toBeLessThanOrEqual(basis[i] as number);
    }
  });

  it('MACD histogram is the gap between the line and its signal', () => {
    const { outputs, series } = computeAll('macd');
    const [hist, line, signal] = outputs as [Float64Array, Float64Array, Float64Array];
    for (let i = 0; i < series.length; i++) {
      if (Number.isNaN(signal[i] as number)) continue;
      expect(hist[i] as number).toBeCloseTo((line[i] as number) - (signal[i] as number), 8);
    }
  });

  it('ATR is never negative', () => {
    const { outputs, series } = computeAll('atr');
    const values = outputs[0] as Float64Array;
    for (let i = 0; i < series.length; i++) {
      const v = values[i] as number;
      if (Number.isNaN(v)) continue;
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('VWAP restarts on each UTC day and sits inside the day range', () => {
    const def = indicatorDef('vwap');
    if (!def) throw new Error('missing vwap');
    const s = new CandleSeries();
    const day = 86_400_000;
    // Two days: the first flat at 100, the second flat at 200. If the anchor
    // did not reset, the second day would be dragged toward 100.
    for (let i = 0; i < 48; i++) {
      const price = i < 24 ? 100 : 200;
      s.push(Date.UTC(2025, 0, 1) + i * 3_600_000, price, price, price, price, 5);
    }
    const out = [new Float64Array(s.length)];
    def.compute(s, {}, out);
    const values = out[0] as Float64Array;
    expect(values[23]).toBeCloseTo(100, 8);
    expect(values[24]).toBeCloseTo(200, 8);
    expect(values[47]).toBeCloseTo(200, 8);
    expect(Math.floor((s.time[24] as number) / day)).toBeGreaterThan(
      Math.floor((s.time[23] as number) / day),
    );
  });

  it('Volume mirrors the candles and averages them', () => {
    const { outputs, series } = computeAll('volume');
    const [vol, ma] = outputs as [Float64Array, Float64Array];
    for (let i = 0; i < series.length; i++) expect(vol[i]).toBe(series.volume[i]);
    const last = series.length - 1;
    let sum = 0;
    for (let i = last - 19; i <= last; i++) sum += series.volume[i] as number;
    expect(ma[last] as number).toBeCloseTo(sum / 20, 8);
  });

  it('every definition has unique output keys and sane defaults', () => {
    const ids = new Set<string>();
    for (const def of INDICATOR_DEFS) {
      expect(ids.has(def.id)).toBe(false);
      ids.add(def.id);
      const keys = new Set(def.outputs.map((o) => o.key));
      expect(keys.size).toBe(def.outputs.length);
      for (const p of def.params) {
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
      }
    }
  });
});

describe('one indicator of each on the chart', () => {
  /**
   * Adding the same indicator twice used to stack a second copy directly over
   * the first, which looked like a rendering fault and left two identical
   * legend rows with no way to tell them apart.
   */
  const reset = (): void => {
    useUi.setState({ indicators: [], paneRatios: {} });
  };

  it('adds an indicator once', () => {
    reset();
    useUi.getState().addIndicator('ema');
    expect(useUi.getState().indicators).toHaveLength(1);
  });

  it('ignores a second add of the same indicator', () => {
    reset();
    useUi.getState().addIndicator('ema');
    useUi.getState().addIndicator('ema');
    useUi.getState().addIndicator('ema');
    expect(useUi.getState().indicators).toHaveLength(1);
  });

  it('still allows different indicators alongside each other', () => {
    reset();
    for (const id of ['ema', 'sma', 'rsi', 'macd']) useUi.getState().addIndicator(id);
    expect(useUi.getState().indicators.map((i) => i.defId)).toEqual(['ema', 'sma', 'rsi', 'macd']);
  });

  it('ignores an indicator that does not exist', () => {
    reset();
    useUi.getState().addIndicator('not-a-real-indicator');
    expect(useUi.getState().indicators).toHaveLength(0);
  });

  it('removes by definition, so the dialog can toggle a row off', () => {
    reset();
    useUi.getState().addIndicator('rsi');
    useUi.getState().addIndicator('macd');
    useUi.getState().removeIndicatorByDef('rsi');
    expect(useUi.getState().indicators.map((i) => i.defId)).toEqual(['macd']);
  });

  it('removing one that is not there changes nothing', () => {
    reset();
    useUi.getState().addIndicator('rsi');
    useUi.getState().removeIndicatorByDef('atr');
    expect(useUi.getState().indicators).toHaveLength(1);
  });

  it('adding after removing works, so a row can be toggled repeatedly', () => {
    reset();
    for (let i = 0; i < 3; i += 1) {
      useUi.getState().addIndicator('bb');
      expect(useUi.getState().indicators).toHaveLength(1);
      useUi.getState().removeIndicatorByDef('bb');
      expect(useUi.getState().indicators).toHaveLength(0);
    }
  });

  it('drops the pane height along with the indicator', () => {
    reset();
    useUi.getState().addIndicator('rsi');
    const id = useUi.getState().indicators[0]?.id as string;
    useUi.getState().setPaneRatios({ [id]: 0.3 });
    useUi.getState().removeIndicatorByDef('rsi');
    expect(useUi.getState().paneRatios[id]).toBeUndefined();
  });
});

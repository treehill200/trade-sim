import type { CandleSeries } from '@/engine/series';
import { ema, fillNaN, rma, rollingMax, rollingMin, rollingStdev, sma } from './math';
import type { IndicatorDef } from './types';

/**
 * The indicator catalogue.
 *
 * Each entry computes over the whole series into preallocated arrays. That is
 * simpler than incremental updates and fast enough: the series only changes
 * when a print arrives, a few times a second, not once per frame.
 */

// Scratch buffers shared by the compute functions. They only ever run one at a
// time on the main thread, so reusing them keeps the indicators allocation-free.
let scratchA: Float64Array = new Float64Array(0);
let scratchB: Float64Array = new Float64Array(0);
let scratchC: Float64Array = new Float64Array(0);

function scratch(which: 0 | 1 | 2, n: number): Float64Array {
  const grow = (buf: Float64Array): Float64Array =>
    buf.length >= n ? buf : new Float64Array(Math.max(n, 1024));
  if (which === 0) return (scratchA = grow(scratchA));
  if (which === 1) return (scratchB = grow(scratchB));
  return (scratchC = grow(scratchC));
}

const CLOSE_SOURCE = (s: CandleSeries): ArrayLike<number> => s.close;

// --- overlays --------------------------------------------------------------

const SMA: IndicatorDef = {
  id: 'sma',
  name: 'Moving Average (Simple)',
  short: 'MA',
  description: 'Average closing price over the last N candles.',
  overlay: true,
  format: 'price',
  params: [{ key: 'length', label: 'Length', min: 1, max: 1000, step: 1, default: 20 }],
  outputs: [{ key: 'ma', label: 'MA', style: 'line', color: '#f2b03d', width: 2 }],
  compute(series, params, out) {
    sma(CLOSE_SOURCE(series), params['length'] ?? 20, series.length, out[0] as Float64Array);
  },
  subtitle: (p) => String(p['length'] ?? 20),
};

const EMA: IndicatorDef = {
  id: 'ema',
  name: 'Moving Average (Exponential)',
  short: 'EMA',
  description: 'Weights recent candles more heavily than older ones.',
  overlay: true,
  format: 'price',
  params: [{ key: 'length', label: 'Length', min: 1, max: 1000, step: 1, default: 50 }],
  outputs: [{ key: 'ema', label: 'EMA', style: 'line', color: '#4d9cf6', width: 2 }],
  compute(series, params, out) {
    ema(CLOSE_SOURCE(series), params['length'] ?? 50, series.length, out[0] as Float64Array);
  },
  subtitle: (p) => String(p['length'] ?? 50),
};

const VWAP: IndicatorDef = {
  id: 'vwap',
  name: 'VWAP (Session)',
  short: 'VWAP',
  description: 'Volume-weighted average price, restarting each UTC day.',
  overlay: true,
  format: 'price',
  params: [],
  outputs: [{ key: 'vwap', label: 'VWAP', style: 'line', color: '#b06df2', width: 2 }],
  compute(series, _params, out) {
    const o = out[0] as Float64Array;
    const n = series.length;
    let pv = 0;
    let vol = 0;
    let day = Number.NaN;
    for (let i = 0; i < n; i++) {
      // Anchor to the UTC day the candle opens in.
      const d = Math.floor((series.time[i] as number) / 86_400_000);
      if (d !== day) {
        day = d;
        pv = 0;
        vol = 0;
      }
      const typical =
        ((series.high[i] as number) + (series.low[i] as number) + (series.close[i] as number)) / 3;
      const v = series.volume[i] as number;
      pv += typical * v;
      vol += v;
      o[i] = vol > 0 ? pv / vol : Number.NaN;
    }
  },
  subtitle: () => 'session',
};

const BOLLINGER: IndicatorDef = {
  id: 'bb',
  name: 'Bollinger Bands',
  short: 'BB',
  description: 'A moving average with bands a number of standard deviations away.',
  overlay: true,
  format: 'price',
  params: [
    { key: 'length', label: 'Length', min: 2, max: 1000, step: 1, default: 20 },
    { key: 'mult', label: 'Std dev', min: 0.1, max: 10, step: 0.1, default: 2 },
  ],
  outputs: [
    {
      key: 'upper',
      label: 'Upper',
      style: 'line',
      color: '#4d9cf6',
      width: 1,
      fillTo: 'lower',
      fillColor: 'rgba(77, 156, 246, 0.08)',
    },
    { key: 'basis', label: 'Basis', style: 'line', color: '#f2b03d', width: 1 },
    { key: 'lower', label: 'Lower', style: 'line', color: '#4d9cf6', width: 1 },
  ],
  compute(series, params, out) {
    const n = series.length;
    const length = params['length'] ?? 20;
    const mult = params['mult'] ?? 2;
    const basis = out[1] as Float64Array;
    const dev = scratch(0, n);
    sma(series.close, length, n, basis);
    rollingStdev(series.close, length, n, dev);
    const upper = out[0] as Float64Array;
    const lower = out[2] as Float64Array;
    for (let i = 0; i < n; i++) {
      const b = basis[i] as number;
      const d = (dev[i] as number) * mult;
      upper[i] = b + d;
      lower[i] = b - d;
    }
  },
  subtitle: (p) => `${p['length'] ?? 20} ${p['mult'] ?? 2}`,
};

// --- separate panes --------------------------------------------------------

const VOLUME: IndicatorDef = {
  id: 'volume',
  name: 'Volume',
  short: 'Vol',
  description: 'Traded volume per candle, coloured by the candle direction.',
  overlay: false,
  format: 'volume',
  params: [{ key: 'maLength', label: 'MA length', min: 0, max: 500, step: 1, default: 20 }],
  outputs: [
    { key: 'volume', label: 'Volume', style: 'volume', color: '#787b86', width: 1 },
    { key: 'ma', label: 'MA', style: 'line', color: '#f2b03d', width: 1 },
  ],
  compute(series, params, out) {
    const n = series.length;
    const vol = out[0] as Float64Array;
    for (let i = 0; i < n; i++) vol[i] = series.volume[i] as number;
    const maLength = params['maLength'] ?? 20;
    if (maLength >= 1) sma(series.volume, maLength, n, out[1] as Float64Array);
    else fillNaN(out[1] as Float64Array, n);
  },
  subtitle: () => '',
};

const RSI: IndicatorDef = {
  id: 'rsi',
  name: 'Relative Strength Index',
  short: 'RSI',
  description: 'Momentum oscillator between 0 and 100.',
  overlay: false,
  format: 'number',
  fixedRange: { min: 0, max: 100 },
  guides: [30, 50, 70],
  params: [{ key: 'length', label: 'Length', min: 2, max: 500, step: 1, default: 14 }],
  outputs: [{ key: 'rsi', label: 'RSI', style: 'line', color: '#b06df2', width: 2 }],
  compute(series, params, out) {
    const n = series.length;
    const length = params['length'] ?? 14;
    const gains = scratch(0, n);
    const losses = scratch(1, n);
    gains[0] = 0;
    losses[0] = 0;
    for (let i = 1; i < n; i++) {
      const change = (series.close[i] as number) - (series.close[i - 1] as number);
      gains[i] = change > 0 ? change : 0;
      losses[i] = change < 0 ? -change : 0;
    }
    const avgGain = out[0] as Float64Array;
    const avgLoss = scratch(2, n);
    rma(gains, length, n, avgGain);
    rma(losses, length, n, avgLoss);
    for (let i = 0; i < n; i++) {
      const g = avgGain[i] as number;
      const l = avgLoss[i] as number;
      if (Number.isNaN(g) || Number.isNaN(l)) {
        avgGain[i] = Number.NaN;
      } else if (l === 0) {
        // No losses in the window: RSI is pinned at its maximum.
        avgGain[i] = 100;
      } else {
        avgGain[i] = 100 - 100 / (1 + g / l);
      }
    }
  },
  subtitle: (p) => String(p['length'] ?? 14),
};

const MACD: IndicatorDef = {
  id: 'macd',
  name: 'MACD',
  short: 'MACD',
  description: 'The gap between two moving averages, with its own signal line.',
  overlay: false,
  format: 'price',
  params: [
    { key: 'fast', label: 'Fast length', min: 1, max: 500, step: 1, default: 12 },
    { key: 'slow', label: 'Slow length', min: 1, max: 500, step: 1, default: 26 },
    { key: 'signal', label: 'Signal length', min: 1, max: 500, step: 1, default: 9 },
  ],
  outputs: [
    {
      key: 'hist',
      label: 'Histogram',
      style: 'histogram',
      color: '#26a96c',
      negativeColor: '#e2445c',
      width: 1,
    },
    { key: 'macd', label: 'MACD', style: 'line', color: '#4d9cf6', width: 2 },
    { key: 'signal', label: 'Signal', style: 'line', color: '#f2603d', width: 2 },
  ],
  compute(series, params, out) {
    const n = series.length;
    const fastBuf = scratch(0, n);
    const slowBuf = scratch(1, n);
    ema(series.close, params['fast'] ?? 12, n, fastBuf);
    ema(series.close, params['slow'] ?? 26, n, slowBuf);

    const macdLine = out[1] as Float64Array;
    for (let i = 0; i < n; i++) macdLine[i] = (fastBuf[i] as number) - (slowBuf[i] as number);

    // The signal EMA must start where the MACD line does, not at index 0,
    // otherwise the leading NaNs poison the whole series.
    const signalLine = out[2] as Float64Array;
    const firstValid = macdLine.findIndex((v, i) => i < n && !Number.isNaN(v));
    if (firstValid < 0) {
      fillNaN(signalLine, n);
      fillNaN(out[0] as Float64Array, n);
      return;
    }
    const tail = scratch(2, n - firstValid);
    ema(macdLine.subarray(firstValid, n), params['signal'] ?? 9, n - firstValid, tail);
    fillNaN(signalLine, firstValid);
    for (let i = firstValid; i < n; i++) signalLine[i] = tail[i - firstValid] as number;

    const hist = out[0] as Float64Array;
    for (let i = 0; i < n; i++) hist[i] = (macdLine[i] as number) - (signalLine[i] as number);
  },
  subtitle: (p) => `${p['fast'] ?? 12} ${p['slow'] ?? 26} ${p['signal'] ?? 9}`,
};

const ATR: IndicatorDef = {
  id: 'atr',
  name: 'Average True Range',
  short: 'ATR',
  description: 'How far price typically travels in one candle.',
  overlay: false,
  format: 'price',
  params: [{ key: 'length', label: 'Length', min: 1, max: 500, step: 1, default: 14 }],
  outputs: [{ key: 'atr', label: 'ATR', style: 'line', color: '#f2b03d', width: 2 }],
  compute(series, params, out) {
    const n = series.length;
    const tr = scratch(0, n);
    for (let i = 0; i < n; i++) {
      const high = series.high[i] as number;
      const low = series.low[i] as number;
      if (i === 0) {
        tr[i] = high - low;
        continue;
      }
      const prevClose = series.close[i - 1] as number;
      tr[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
    rma(tr, params['length'] ?? 14, n, out[0] as Float64Array);
  },
  subtitle: (p) => String(p['length'] ?? 14),
};

const STOCHASTIC: IndicatorDef = {
  id: 'stoch',
  name: 'Stochastic',
  short: 'Stoch',
  description: 'Where the close sits within the recent high-low range.',
  overlay: false,
  format: 'number',
  fixedRange: { min: 0, max: 100 },
  guides: [20, 50, 80],
  params: [
    { key: 'k', label: '%K length', min: 1, max: 500, step: 1, default: 14 },
    { key: 'smooth', label: '%K smoothing', min: 1, max: 100, step: 1, default: 3 },
    { key: 'd', label: '%D smoothing', min: 1, max: 100, step: 1, default: 3 },
  ],
  outputs: [
    { key: 'k', label: '%K', style: 'line', color: '#4d9cf6', width: 2 },
    { key: 'd', label: '%D', style: 'line', color: '#f2603d', width: 2 },
  ],
  compute(series, params, out) {
    const n = series.length;
    const highest = scratch(0, n);
    const lowest = scratch(1, n);
    rollingMax(series.high, params['k'] ?? 14, n, highest);
    rollingMin(series.low, params['k'] ?? 14, n, lowest);

    const raw = scratch(2, n);
    for (let i = 0; i < n; i++) {
      const hi = highest[i] as number;
      const lo = lowest[i] as number;
      const span = hi - lo;
      // A perfectly flat window has no range to divide by; call it midpoint.
      raw[i] = Number.isNaN(hi) ? Number.NaN : span === 0 ? 50 : (((series.close[i] as number) - lo) / span) * 100;
    }
    const k = out[0] as Float64Array;
    sma(raw, params['smooth'] ?? 3, n, k);
    sma(k, params['d'] ?? 3, n, out[1] as Float64Array);
  },
  subtitle: (p) => `${p['k'] ?? 14} ${p['smooth'] ?? 3} ${p['d'] ?? 3}`,
};

export const INDICATOR_DEFS: IndicatorDef[] = [
  SMA,
  EMA,
  VWAP,
  BOLLINGER,
  VOLUME,
  RSI,
  MACD,
  ATR,
  STOCHASTIC,
];

const BY_ID = new Map(INDICATOR_DEFS.map((d) => [d.id, d]));

export function indicatorDef(id: string): IndicatorDef | undefined {
  return BY_ID.get(id);
}

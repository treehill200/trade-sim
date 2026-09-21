import type { CandleSeries } from '@/engine/series';

/** A numeric setting shown in an indicator's settings dialog. */
export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

/** How one of an indicator's output series is drawn. */
export type OutputStyle = 'line' | 'histogram' | 'volume';

export interface OutputSpec {
  key: string;
  label: string;
  style: OutputStyle;
  color: string;
  /** Colour for values below zero; histograms only. */
  negativeColor?: string;
  width: number;
  /** Fill the band between this output and another one, e.g. Bollinger. */
  fillTo?: string;
  fillColor?: string;
}

/** How an indicator pane labels its axis. */
export type ValueFormat = 'price' | 'number' | 'volume';

export interface IndicatorDef {
  id: string;
  /** Full name, shown in the search dialog. */
  name: string;
  /** Short name used in the legend, e.g. "MA". */
  short: string;
  description: string;
  /** True when the indicator draws over the candles instead of in its own pane. */
  overlay: boolean;
  params: ParamSpec[];
  outputs: OutputSpec[];
  format: ValueFormat;
  /** Range the pane always covers, for oscillators with natural bounds. */
  fixedRange?: { min: number; max: number };
  /** Horizontal reference lines drawn in the pane, e.g. RSI 30 and 70. */
  guides?: number[];
  /**
   * Fill `out[k]` with each output over the whole series.
   *
   * Arrays are at least `series.length` long and are reused between calls, so
   * implementations must write every index they claim — including NaN for the
   * warm-up region.
   */
  compute(series: CandleSeries, params: Record<string, number>, out: Float64Array[]): void;
  /** Legend suffix describing the settings, e.g. "20" or "12 26 9". */
  subtitle(params: Record<string, number>): string;
}

/** One configured indicator on the chart. */
export interface IndicatorInstance {
  /** Unique per chart, so the same indicator can be added twice. */
  id: string;
  defId: string;
  params: Record<string, number>;
  /** Per-output colour overrides, keyed by output key. */
  colors: Record<string, string>;
  /** Per-output line width overrides, keyed by output key. */
  widths: Record<string, number>;
  visible: boolean;
}

export function defaultParams(def: IndicatorDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

export function defaultColors(def: IndicatorDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of def.outputs) out[o.key] = o.color;
  return out;
}

export function defaultWidths(def: IndicatorDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of def.outputs) out[o.key] = o.width;
  return out;
}

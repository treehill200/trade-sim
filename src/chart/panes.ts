import { PriceScale } from './scales';
import type { IndicatorDef, IndicatorInstance, ValueFormat } from '@/indicators/types';
import type { IndicatorResult } from '@/indicators/engine';

/** One indicator drawn in a pane, with everything needed to render it. */
export interface PaneItem {
  instance: IndicatorInstance;
  def: IndicatorDef;
  result: IndicatorResult;
}

export interface Pane {
  /** "main" for the price pane, otherwise the indicator instance's id. */
  id: string;
  kind: 'main' | 'indicator';
  priceScale: PriceScale;
  items: PaneItem[];
  format: ValueFormat;
  guides: number[];
}

/** Height a new indicator pane takes, as a fraction of the plot area. */
export const DEFAULT_PANE_RATIO = 0.22;
/**
 * The price pane never shrinks below this fraction.
 *
 * Indicator panes are squeezed proportionally to respect it, so stacking four
 * of them leaves the candles readable instead of reducing them to a sliver.
 */
export const MIN_MAIN_RATIO = 0.4;
/** An indicator pane never shrinks below this fraction. */
export const MIN_PANE_RATIO = 0.06;
/** Height of the draggable gap between two panes, in CSS pixels. */
export const PANE_SEPARATOR = 6;

/**
 * Turn pane height ratios into pixel rectangles.
 *
 * Ratios are relative weights rather than exact fractions: the price pane
 * takes whatever the indicator panes leave, and everything is normalised so
 * the panes always fill the plot area exactly, whatever the ratios add up to.
 */
export function layoutPanes(
  paneIds: string[],
  ratios: Record<string, number>,
  totalHeight: number,
): { id: string; top: number; height: number }[] {
  const count = paneIds.length;
  if (count === 0) return [];
  const gaps = (count - 1) * PANE_SEPARATOR;
  const usable = Math.max(40, totalHeight - gaps);

  const indicatorIds = paneIds.slice(1);
  const weights: number[] = [];
  let indicatorTotal = 0;
  for (const id of indicatorIds) {
    const r = Math.max(MIN_PANE_RATIO, ratios[id] ?? DEFAULT_PANE_RATIO);
    weights.push(r);
    indicatorTotal += r;
  }
  // Squeeze the indicator panes proportionally if they would starve the price
  // pane, rather than letting the main chart disappear.
  const maxIndicatorTotal = 1 - MIN_MAIN_RATIO;
  if (indicatorTotal > maxIndicatorTotal) {
    const scale = maxIndicatorTotal / indicatorTotal;
    for (let i = 0; i < weights.length; i++) weights[i] = (weights[i] as number) * scale;
    indicatorTotal = maxIndicatorTotal;
  }

  const out: { id: string; top: number; height: number }[] = [];
  let y = 0;
  const mainHeight = Math.round(usable * (1 - indicatorTotal));
  out.push({ id: paneIds[0] as string, top: y, height: mainHeight });
  y += mainHeight + PANE_SEPARATOR;

  indicatorIds.forEach((id, i) => {
    const last = i === indicatorIds.length - 1;
    // The final pane absorbs rounding so the stack ends exactly at the bottom.
    const height = last
      ? Math.max(20, totalHeight - y)
      : Math.round(usable * (weights[i] as number));
    out.push({ id, top: y, height });
    y += height + PANE_SEPARATOR;
  });
  return out;
}

/**
 * Move a separator by `deltaPx`, adjusting the two panes it sits between.
 *
 * Returns the updated ratio map. The price pane has no stored ratio — it takes
 * what is left — so dragging the first separator changes only the pane below.
 */
export function resizePane(
  paneIds: string[],
  ratios: Record<string, number>,
  separatorIndex: number,
  deltaPx: number,
  totalHeight: number,
): Record<string, number> {
  if (totalHeight <= 0) return ratios;
  const below = paneIds[separatorIndex + 1];
  if (below === undefined) return ratios;
  const next = { ...ratios };
  const delta = deltaPx / totalHeight;

  const belowRatio = Math.max(MIN_PANE_RATIO, next[below] ?? DEFAULT_PANE_RATIO);
  const above = paneIds[separatorIndex] as string;

  if (separatorIndex === 0) {
    // Dragging down grows the price pane, so the pane below shrinks.
    next[below] = clampRatio(belowRatio - delta);
    return next;
  }
  const aboveRatio = Math.max(MIN_PANE_RATIO, next[above] ?? DEFAULT_PANE_RATIO);
  next[above] = clampRatio(aboveRatio + delta);
  next[below] = clampRatio(belowRatio - delta);
  return next;
}

function clampRatio(r: number): number {
  return Math.min(1 - MIN_MAIN_RATIO, Math.max(MIN_PANE_RATIO, r));
}

/** Build the price scales for a pane set, reusing existing ones where possible. */
export function syncPriceScales(
  paneIds: string[],
  scales: Map<string, PriceScale>,
): Map<string, PriceScale> {
  for (const id of paneIds) {
    if (!scales.has(id)) scales.set(id, new PriceScale());
  }
  for (const id of [...scales.keys()]) {
    if (!paneIds.includes(id)) scales.delete(id);
  }
  return scales;
}

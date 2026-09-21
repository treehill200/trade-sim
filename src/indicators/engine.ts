import type { CandleSeries } from '@/engine/series';
import { indicatorDef } from './defs';
import type { IndicatorDef, IndicatorInstance } from './types';

export interface IndicatorResult {
  outputs: Float64Array[];
  length: number;
}

interface CacheEntry extends IndicatorResult {
  series: CandleSeries;
  fingerprint: string;
}

/**
 * Computes and caches indicator outputs.
 *
 * Indicators are recomputed over the whole series rather than updated
 * incrementally. That sounds wasteful, but the series only changes when a
 * print arrives — a few times a second — not once per frame, and a full pass
 * over 43,000 candles is well under a millisecond for everything in the
 * catalogue. Streaming versions would need each indicator to save and restore
 * its internal state to recompute the live candle, which is a lot of
 * machinery and a lot of places to get subtly wrong.
 */
class IndicatorEngine {
  private cache = new Map<string, CacheEntry>();

  /**
   * Outputs for `instance` over `series`, recomputing only when something
   * that affects the result has changed.
   */
  compute(instance: IndicatorInstance, series: CandleSeries): IndicatorResult | null {
    const def = indicatorDef(instance.defId);
    if (!def) return null;

    const n = series.length;
    const fingerprint = `${n}|${n > 0 ? series.close[n - 1] : 0}|${n > 0 ? series.time[n - 1] : 0}|${JSON.stringify(instance.params)}`;
    const hit = this.cache.get(instance.id);
    if (hit && hit.series === series && hit.fingerprint === fingerprint) return hit;

    const outputs = ensureOutputs(hit, def, n);
    def.compute(series, instance.params, outputs);
    const entry: CacheEntry = { outputs, length: n, series, fingerprint };
    this.cache.set(instance.id, entry);
    return entry;
  }

  /**
   * The most recent result for an instance, without recomputing.
   *
   * The legend reads values the render loop has already produced this frame,
   * so it never triggers a second pass over the series.
   */
  peek(instanceId: string): IndicatorResult | null {
    return this.cache.get(instanceId) ?? null;
  }

  /** Drop cached results for indicators that are no longer on the chart. */
  prune(activeIds: Iterable<string>): void {
    const keep = new Set(activeIds);
    for (const id of [...this.cache.keys()]) {
      if (!keep.has(id)) this.cache.delete(id);
    }
  }
}

function ensureOutputs(hit: CacheEntry | undefined, def: IndicatorDef, n: number): Float64Array[] {
  const wanted = def.outputs.length;
  const existing = hit?.outputs;
  if (existing && existing.length === wanted && (existing[0]?.length ?? 0) >= n) return existing;
  // Over-allocate so a growing series does not reallocate on every new candle.
  const cap = Math.max(1024, Math.ceil(n * 1.25));
  return Array.from({ length: wanted }, () => new Float64Array(cap));
}

export const indicatorEngine = new IndicatorEngine();

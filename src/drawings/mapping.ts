import type { CandleSeries } from '@/engine/series';
import type { PriceScale, TimeScale } from '@/chart/scales';

/**
 * Converts between data space (time, price) and screen space.
 *
 * The market is continuous, so candle times are evenly spaced and the mapping
 * from a timestamp to a bar index is plain arithmetic — including for times
 * that fall between candles or beyond the newest one, which is what lets a ray
 * extend into the empty space on the right.
 */
export class DrawingMap {
  private readonly time0: number;
  private readonly stepMs: number;

  constructor(
    series: CandleSeries,
    timeframeMs: number,
    readonly timeScale: TimeScale,
    readonly priceScale: PriceScale,
  ) {
    this.time0 = series.length > 0 ? (series.time[0] as number) : 0;
    this.stepMs = Math.max(1, timeframeMs);
  }

  indexOfTime(time: number): number {
    return (time - this.time0) / this.stepMs;
  }

  timeOfIndex(index: number): number {
    return this.time0 + index * this.stepMs;
  }

  xOfTime(time: number): number {
    return this.timeScale.xOfIndex(this.indexOfTime(time));
  }

  timeOfX(x: number): number {
    return this.timeOfIndex(this.timeScale.indexOfX(x));
  }

  yOfPrice(price: number): number {
    return this.priceScale.yOfPrice(price);
  }

  priceOfY(y: number): number {
    return this.priceScale.priceOfY(y);
  }

  /** Snap a timestamp to the candle that contains it. */
  snapTime(time: number): number {
    return this.timeOfIndex(Math.round(this.indexOfTime(time)));
  }
}

/**
 * Nearest of a candle's four prices, when magnet mode is on.
 *
 * Returns the raw price unchanged if the timestamp is outside the series, so
 * drawing in the empty space to the right of the newest candle still works.
 */
export function magnetPrice(
  series: CandleSeries,
  map: DrawingMap,
  time: number,
  price: number,
): number {
  const index = Math.round(map.indexOfTime(time));
  if (index < 0 || index >= series.length) return price;
  const candidates = [
    series.open[index] as number,
    series.high[index] as number,
    series.low[index] as number,
    series.close[index] as number,
  ];
  let best = price;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const d = Math.abs(c - price);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}

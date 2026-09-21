/** Timeframe catalogue. Every timeframe is an exact multiple of the 1s base. */

export const TIMEFRAMES = [
  '1s', '5s', '15s', '30s',
  '1m', '3m', '5m', '15m', '30m',
  '1h', '4h', '1D',
] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

/** Seconds per candle for each timeframe. */
export const TF_SECONDS: Record<Timeframe, number> = {
  '1s': 1,
  '5s': 5,
  '15s': 15,
  '30s': 30,
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
};

/** Timeframes built from sub-minute data; we only keep 24h of these. */
export const SECOND_TIMEFRAMES: Timeframe[] = ['1s', '5s', '15s', '30s'];

export function isSecondTimeframe(tf: Timeframe): boolean {
  return TF_SECONDS[tf] < 60;
}

/**
 * Floor a millisecond timestamp to the start of its candle.
 *
 * All periods here divide 86400 evenly, so flooring against the Unix epoch
 * also lines up with UTC midnight — which is what makes a 1D candle an exact
 * aggregation of the 1h candles inside it.
 */
export function floorToTf(ms: number, tf: Timeframe): number {
  const step = TF_SECONDS[tf] * 1000;
  return Math.floor(ms / step) * step;
}

export function parseTimeframe(value: string): Timeframe | null {
  return (TIMEFRAMES as readonly string[]).includes(value) ? (value as Timeframe) : null;
}

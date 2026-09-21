import { seedFromString } from './hash';

/** Everything about the fictional DAVID/USD market lives here. */
export interface MarketConfig {
  symbol: string;
  name: string;
  /** Integer seed driving the whole simulated world. */
  seed: number;
  /** Start of simulated history, ms since epoch, aligned to a UTC day. */
  genesisMs: number;
  /** Opening price at genesis, in integer cents. */
  startPriceCents: number;
  /** Minimum price increment, in cents. */
  tickSizeCents: number;
  /** Price updates emitted per simulated second. */
  subTicksPerSecond: number;
}

/**
 * Bumped whenever a change to the simulator would make previously saved
 * history disagree with freshly generated history. Saved data from an older
 * version is discarded and regenerated rather than stitched onto a walk that
 * no longer matches it.
 */
export const ENGINE_VERSION = 2;

export const DEFAULT_SYMBOL = 'DAVID/USD';
export const DEFAULT_NAME = 'David Coin';
export const DEFAULT_START_PRICE_CENTS = 4_000_000; // $40,000.00
export const TICK_SIZE_CENTS = 1; // $0.01
export const SUB_TICKS_PER_SECOND = 4;

/** How much history the very first launch generates. */
export const BACKFILL_DAYS = 30;

/** Seconds-resolution candles are only kept for the most recent 24 hours. */
export const SECONDS_HISTORY_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 86_400_000;

export function makeDefaultConfig(now: number, seedText = 'david-coin'): MarketConfig {
  // Genesis is pinned to a UTC midnight so that 1D candles are whole days.
  const genesisMs = Math.floor((now - BACKFILL_DAYS * DAY_MS) / DAY_MS) * DAY_MS;
  return {
    symbol: DEFAULT_SYMBOL,
    name: DEFAULT_NAME,
    seed: seedFromString(seedText),
    genesisMs,
    startPriceCents: DEFAULT_START_PRICE_CENTS,
    tickSizeCents: TICK_SIZE_CENTS,
    subTicksPerSecond: SUB_TICKS_PER_SECOND,
  };
}

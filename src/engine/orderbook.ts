import { mix32 } from './hash';

export interface BookLevel {
  /** Price in cents. */
  price: number;
  /** Resting size in DAVID. */
  size: number;
}

export interface OrderBook {
  bids: BookLevel[];
  asks: BookLevel[];
  bid: number;
  ask: number;
  spread: number;
}

/**
 * Plausible synthetic depth around the current quote.
 *
 * Depth is thin at the touch and thickens further out, with round-number
 * price levels carrying extra size, and the whole ladder thinning out as
 * volatility rises (market makers pull quotes when things get violent).
 *
 * It is derived from the price and a time bucket rather than simulated order
 * by order, which keeps it cheap and stable between frames.
 */
export function buildOrderBook(
  midCents: number,
  halfSpreadCents: number,
  volFactor: number,
  levels: number,
  timeBucket: number,
  tickSizeCents: number,
): OrderBook {
  const bid = midCents - halfSpreadCents;
  const ask = midCents + halfSpreadCents;
  const bids: BookLevel[] = [];
  const asks: BookLevel[] = [];

  // Level spacing grows with volatility so the ladder always spans a sensible
  // slice of the book instead of collapsing into one tick.
  const step = Math.max(tickSizeCents, Math.round(halfSpreadCents * 0.8));
  const liquidity = 3.2 / Math.max(0.4, Math.pow(volFactor, 0.8));

  for (let i = 0; i < levels; i++) {
    const bidPrice = bid - i * step;
    const askPrice = ask + i * step;
    bids.push({ price: bidPrice, size: levelSize(bidPrice, i, liquidity, timeBucket, 1) });
    asks.push({ price: askPrice, size: levelSize(askPrice, i, liquidity, timeBucket, 2) });
  }

  return { bids, asks, bid, ask, spread: ask - bid };
}

function levelSize(
  priceCents: number,
  depth: number,
  liquidity: number,
  timeBucket: number,
  side: number,
): number {
  const jitter = mix32(priceCents ^ Math.imul(timeBucket, 0x9e3779b1) ^ side) / 4294967296;
  // Size builds up as you walk away from the touch, then flattens out.
  const shape = 0.35 + Math.log1p(depth) * 0.85;
  // Round dollar and round hundred-dollar levels attract resting orders.
  const roundBonus =
    priceCents % 1_000_00 === 0 ? 2.4 : priceCents % 100_00 === 0 ? 1.5 : priceCents % 10_00 === 0 ? 1.15 : 1;
  const size = liquidity * shape * roundBonus * (0.45 + jitter * 1.4);
  return Math.max(0.001, Math.round(size * 1000) / 1000);
}

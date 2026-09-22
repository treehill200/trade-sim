import { applyPpm, notional, qtyFromNotional, QTY_SCALE, type Cents, type Qty } from './money';
import {
  FLAT_POSITION,
  type Account,
  type AccountSettings,
  type Execution,
  type Order,
  type Position,
  type Quote,
  type Side,
} from './types';

/**
 * The trading engine.
 *
 * Every function here is pure: it takes an account and returns a new one. That
 * keeps the rules — fills, commission, realised profit, margin, liquidation —
 * testable without a browser, a chart or a clock, and means the UI can never
 * put the account into a state the engine did not sanction.
 */

/** Reference order size for the slippage model, in micro-units (2 DAVID). */
const SLIPPAGE_REFERENCE_QTY = 2 * QTY_SCALE;

export function sideSign(side: Side): 1 | -1 {
  return side === 'buy' ? 1 : -1;
}

/** Average entry price of an open position, in cents; 0 when flat. */
export function averageEntry(position: Position): Cents {
  if (position.qty === 0) return 0;
  return Math.round((position.entryNotionalCents * QTY_SCALE) / position.qty);
}

/** Profit or loss the open position would book if closed at `markCents`. */
export function unrealisedPnl(position: Position, markCents: Cents): Cents {
  if (position.qty === 0) return 0;
  return notional(markCents, position.qty) - position.entryNotionalCents;
}

/** Absolute notional value of the open position at `markCents`. */
export function positionNotional(position: Position, markCents: Cents): Cents {
  return Math.abs(notional(markCents, position.qty));
}

/**
 * The price a market order actually gets.
 *
 * Without slippage it is simply the far side of the spread. With slippage it
 * moves further against the trader as the order grows relative to a reference
 * size and as volatility rises — the two things that genuinely make a market
 * order fill worse.
 */
export function fillPrice(
  side: Side,
  qty: Qty,
  quote: Quote,
  settings: AccountSettings,
): Cents {
  const base = settings.spread
    ? side === 'buy'
      ? quote.askCents
      : quote.bidCents
    : quote.lastCents;
  if (!settings.slippage) return base;

  const halfSpread = Math.max(1, Math.round((quote.askCents - quote.bidCents) / 2));
  const sizeRatio = Math.abs(qty) / SLIPPAGE_REFERENCE_QTY;
  // Concave in size: a ten times bigger order costs about four times as much
  // extra, which is how walking a real book behaves.
  const sizeImpact = Math.pow(Math.max(sizeRatio, 0), 0.6);
  const vol = Math.max(0.2, quote.volFactor);
  const slip = Math.round(halfSpread * (0.2 + 0.8 * sizeImpact) * vol);
  return side === 'buy' ? base + slip : Math.max(1, base - slip);
}

export interface FillOutcome {
  position: Position;
  /** Profit or loss booked by the portion of the fill that closed. */
  realisedCents: Cents;
}

/**
 * Apply a fill to a position.
 *
 * Handles all four cases in one pass: opening, adding, reducing, and reversing
 * through flat. The closed portion's cost comes out of the stored notional in
 * proportion to the quantity closed, so the remaining average entry is exact.
 */
export function applyFill(
  position: Position,
  side: Side,
  qty: Qty,
  priceCents: Cents,
  timeMs: number,
): FillOutcome {
  const signed = sideSign(side) * Math.abs(qty);
  if (signed === 0) return { position, realisedCents: 0 };

  const open = position.qty;
  // Same direction, or from flat: the position simply grows.
  if (open === 0 || Math.sign(open) === Math.sign(signed)) {
    return {
      position: {
        qty: open + signed,
        entryNotionalCents: position.entryNotionalCents + notional(priceCents, signed),
        openedAt: open === 0 ? timeMs : position.openedAt,
      },
      realisedCents: 0,
    };
  }

  const closeQty = Math.min(Math.abs(open), Math.abs(signed));
  const closed = Math.sign(open) * closeQty;
  // Cost of exactly the portion being closed.
  const closedCost = Math.round((position.entryNotionalCents * closeQty) / Math.abs(open));
  const realisedCents = notional(priceCents, closed) - closedCost;

  const remaining = open + signed;
  if (remaining === 0) {
    return { position: { ...FLAT_POSITION }, realisedCents };
  }
  if (Math.sign(remaining) === Math.sign(open)) {
    // Reduced, not closed: keep the rest of the original cost.
    return {
      position: {
        qty: remaining,
        entryNotionalCents: position.entryNotionalCents - closedCost,
        openedAt: position.openedAt,
      },
      realisedCents,
    };
  }
  // Reversed straight through flat: the excess opens a fresh position.
  return {
    position: {
      qty: remaining,
      entryNotionalCents: notional(priceCents, remaining),
      openedAt: timeMs,
    },
    realisedCents,
  };
}

export interface SubmitResult {
  account: Account;
  order: Order;
  execution: Execution | null;
}

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

/** Test seam, so ids are stable across a test run. */
export function resetIdSequence(): void {
  sequence = 0;
}

export interface MarketOrderPreview {
  /** Price it is expected to fill at, spread and slippage included. */
  priceCents: Cents;
  /** Commission it would pay, at the taker rate. */
  feeCents: Cents;
  /** Realised P&L the fill would book, if it closes any of the position. */
  realisedCents: Cents;
  /** The position that would result. */
  position: Position;
  /** Balance after the fill's realised P&L and its commission. */
  balanceCents: Cents;
  /** Equity once the fill, its commission and its mark-to-market have landed. */
  equityCents: Cents;
  /** Margin the resulting position would have to be backed by. */
  requiredCents: Cents;
  /** Whether the order grows exposure; only those are margin-checked. */
  grows: boolean;
  /** Whether the account can cover it. */
  affordable: boolean;
  /** How much more equity it would take to cover it; 0 when it is affordable. */
  shortfallCents: Cents;
}

/**
 * Work out what a market order would do, without doing it.
 *
 * The order panel has to tell the user whether an order is affordable before
 * they commit to it, and the only answer that cannot drift from reality is the
 * one the submit path itself computes — so both go through here. Getting this
 * wrong is worse than it sounds: a panel that says "required margin 95,000,
 * available 100,000" and then rejects the order looks broken, because from the
 * user's side it is.
 */
export function previewMarketOrder(
  account: Account,
  side: Side,
  qty: Qty,
  quote: Quote,
): MarketOrderPreview {
  const size = Math.abs(qty);
  const priceCents = fillPrice(side, size, quote, account.settings);
  const { position, realisedCents } = applyFill(
    account.position,
    side,
    size,
    priceCents,
    quote.timeMs,
  );
  const feeCents = applyPpm(Math.abs(notional(priceCents, size)), account.settings.takerFeePpm);
  const balanceCents = account.balanceCents + realisedCents - feeCents;
  const equityCents = balanceCents + unrealisedPnl(position, quote.lastCents);
  const requiredCents = requiredMargin(position, quote.lastCents, account.settings);
  const grows = Math.abs(position.qty) > Math.abs(account.position.qty);
  const shortfallCents = grows ? Math.max(0, requiredCents - equityCents) : 0;
  return {
    priceCents,
    feeCents,
    realisedCents,
    position,
    balanceCents,
    equityCents,
    requiredCents,
    grows,
    affordable: shortfallCents === 0,
    shortfallCents,
  };
}

/**
 * The largest market order this account could actually afford right now.
 *
 * Solved by bisection rather than algebra, because the cost of an order is not
 * proportional to its size: slippage grows with it, the spread is paid across
 * all of it, and an existing position may be reduced rather than grown. Asking
 * `previewMarketOrder` where the edge is finds it exactly, whatever the rules
 * happen to be, and costs a few dozen multiplications.
 *
 * This is what the order panel's "%" control divides up, so that 100% means the
 * biggest order that will actually be accepted rather than a number that is
 * always rejected.
 */
export function maxAffordableQty(account: Account, side: Side, quote: Quote): Qty {
  const equity = account.balanceCents + unrealisedPnl(account.position, quote.lastCents);
  if (equity <= 0) return 0;
  const reference = Math.max(1, side === 'buy' ? quote.askCents : quote.bidCents);
  // Margin alone would allow this much, so the true answer is never above it.
  let hi = qtyFromNotional(equity * Math.max(1, account.settings.leverage), reference);
  if (hi <= 0) return 0;
  if (previewMarketOrder(account, side, hi, quote).affordable) return hi;

  let lo = 0;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (previewMarketOrder(account, side, mid, quote).affordable) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Submit a market order.
 *
 * Rejected when the account cannot cover the margin the order would need,
 * measured after the fill so that an order which reduces a position is always
 * allowed even when margin is tight.
 */
export function submitMarketOrder(
  account: Account,
  side: Side,
  qty: Qty,
  quote: Quote,
  options: { system?: boolean } = {},
): SubmitResult {
  const now = quote.timeMs;
  const order: Order = {
    id: nextId('o'),
    side,
    type: 'market',
    qty: Math.abs(qty),
    status: 'working',
    createdAt: now,
    ...(options.system ? { system: true } : {}),
  };

  if (order.qty <= 0) {
    return {
      account,
      order: { ...order, status: 'rejected', reason: 'Quantity must be greater than zero' },
      execution: null,
    };
  }

  const preview = previewMarketOrder(account, side, order.qty, quote);
  const { priceCents: price, feeCents, realisedCents, position, balanceCents } = preview;

  // A system order (a liquidation) is never blocked by its own margin check.
  if (!options.system && !preview.affordable) {
    return {
      account,
      order: { ...order, status: 'rejected', reason: 'Not enough margin' },
      execution: null,
    };
  }

  const filled: Order = {
    ...order,
    status: 'filled',
    filledAt: now,
    fillPriceCents: price,
    feeCents,
  };
  const execution: Execution = {
    id: nextId('x'),
    orderId: order.id,
    time: now,
    side,
    qty: order.qty,
    priceCents: price,
    feeCents,
    realisedCents,
    ...(options.system ? { system: true } : {}),
  };

  return {
    account: {
      ...account,
      balanceCents,
      position,
      orders: [...account.orders, filled],
      executions: [...account.executions, execution],
      realisedPnlCents: account.realisedPnlCents + realisedCents,
      feesCents: account.feesCents + feeCents,
    },
    order: filled,
    execution,
  };
}

/** Margin the position must be backed by, in cents. */
export function requiredMargin(
  position: Position,
  markCents: Cents,
  settings: AccountSettings,
): Cents {
  if (position.qty === 0) return 0;
  const lev = Math.max(1, settings.leverage);
  return Math.ceil(positionNotional(position, markCents) / lev);
}

/** Equity that must remain for the position to stay open. */
export function maintenanceMargin(
  position: Position,
  markCents: Cents,
  settings: AccountSettings,
): Cents {
  if (position.qty === 0) return 0;
  return applyPpm(positionNotional(position, markCents), settings.maintenanceMarginPpm);
}

/**
 * Price at which equity would fall to the maintenance requirement.
 *
 * Solves `balance + notional(p, q) - entry = |q| * p * m` for p. Returns null
 * when flat, or when the position can never be liquidated because the balance
 * already covers it at any price.
 *
 * This is a derived display value rather than an amount of money, so it is
 * computed in floating point and then rounded to the nearest cent.
 */
export function liquidationPrice(
  position: Position,
  balanceCents: Cents,
  settings: AccountSettings,
): Cents | null {
  const q = position.qty;
  if (q === 0) return null;
  const m = settings.maintenanceMarginPpm / 1_000_000;
  const denominator = q - Math.abs(q) * m;
  if (denominator === 0) return null;
  const price = ((position.entryNotionalCents - balanceCents) * QTY_SCALE) / denominator;
  if (!Number.isFinite(price) || price <= 0) return null;
  return Math.round(price);
}

export interface LiquidationResult {
  account: Account;
  /** The forced closing execution, when one happened. */
  execution: Execution | null;
}

/**
 * Close the position at market if equity has fallen below maintenance.
 *
 * Uses the last traded price rather than the far side of the spread for the
 * test, then fills through the normal market path so commission and slippage
 * apply exactly as they would to a manual close.
 */
export function checkLiquidation(account: Account, quote: Quote): LiquidationResult {
  const position = account.position;
  if (position.qty === 0) return { account, execution: null };

  const equity = account.balanceCents + unrealisedPnl(position, quote.lastCents);
  const maintenance = maintenanceMargin(position, quote.lastCents, account.settings);
  if (equity > maintenance) return { account, execution: null };

  const side: Side = position.qty > 0 ? 'sell' : 'buy';
  const result = submitMarketOrder(account, side, Math.abs(position.qty), quote, { system: true });
  return { account: result.account, execution: result.execution };
}

export function createAccount(id: string, name: string, settings: AccountSettings, now: number): Account {
  return {
    id,
    name,
    settings,
    balanceCents: settings.startingBalanceCents,
    position: { ...FLAT_POSITION },
    orders: [],
    executions: [],
    realisedPnlCents: 0,
    feesCents: 0,
    notes: {},
    createdAt: now,
  };
}

/** Wipe an account's history and return it to its starting balance. */
export function resetAccount(account: Account): Account {
  return {
    ...account,
    balanceCents: account.settings.startingBalanceCents,
    position: { ...FLAT_POSITION },
    orders: [],
    executions: [],
    realisedPnlCents: 0,
    feesCents: 0,
    notes: {},
  };
}

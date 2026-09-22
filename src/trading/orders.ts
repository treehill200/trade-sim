import {
  applyFill,
  fillPrice,
  requiredMargin,
  sideSign,
  submitMarketOrder,
  unrealisedPnl,
} from './engine';
import { applyPpm, notional, type Cents } from './money';
import type {
  Account,
  Execution,
  Order,
  OrderRequest,
  PriceRange,
  Quote,
  Side,
} from './types';

/**
 * Resting order types: limit, stop and stop-limit, plus bracket exits.
 *
 * Market orders are handled in `engine.ts` because they never rest. Everything
 * here is about orders that sit in the book until the price comes to them, and
 * is written as the same kind of pure function: account in, account out.
 */

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export function resetOrderIdSequence(): void {
  sequence = 0;
}

export interface SubmitOrderResult {
  account: Account;
  order: Order;
  executions: Execution[];
  rejected?: string;
}

/**
 * Place an order of any type.
 *
 * A market order fills immediately through the engine; anything else becomes a
 * working order. Bracket prices ride along on the order and are turned into
 * real exit orders the moment it fills.
 */
export function submitOrder(
  account: Account,
  request: OrderRequest,
  quote: Quote,
): SubmitOrderResult {
  const qty = Math.abs(request.qty);
  if (qty <= 0) {
    return {
      account,
      order: rejection(request, 'Quantity must be greater than zero', quote.timeMs),
      executions: [],
      rejected: 'Quantity must be greater than zero',
    };
  }

  if (request.type === 'market') {
    const result = submitMarketOrder(account, request.side, qty, quote);
    if (result.order.status === 'rejected') {
      return {
        account,
        order: result.order,
        executions: [],
        ...(result.order.reason ? { rejected: result.order.reason } : {}),
      };
    }
    let next = result.account;
    const executions = result.execution ? [result.execution] : [];
    if (request.takeProfitCents !== undefined || request.stopLossCents !== undefined) {
      next = attachBrackets(next, request, quote.timeMs);
    }
    return { account: next, order: result.order, executions };
  }

  const needsLimit = request.type === 'limit' || request.type === 'stopLimit';
  const needsStop = request.type === 'stop' || request.type === 'stopLimit';
  if (needsLimit && !isPrice(request.limitCents)) {
    return reject(account, request, 'A limit price is required', quote.timeMs);
  }
  if (needsStop && !isPrice(request.stopCents)) {
    return reject(account, request, 'A stop price is required', quote.timeMs);
  }

  // Margin is checked against what the order would open if it filled right
  // now; reduce-only orders free margin instead of using it.
  if (!request.reduceOnly) {
    const reference = request.limitCents ?? request.stopCents ?? quote.lastCents;
    const hypothetical = applyFill(account.position, request.side, qty, reference, quote.timeMs);
    const needed = requiredMargin(hypothetical.position, reference, account.settings);
    const equity = account.balanceCents + unrealisedPnl(account.position, quote.lastCents);
    const grows = Math.abs(hypothetical.position.qty) > Math.abs(account.position.qty);
    if (grows && equity < needed) {
      return reject(account, request, 'Not enough margin', quote.timeMs);
    }
  }

  const marketableLimit =
    request.type === 'limit' &&
    isPrice(request.limitCents) &&
    (request.side === 'buy'
      ? request.limitCents >= quote.askCents
      : request.limitCents <= quote.bidCents);

  const order: Order = {
    id: nextId('o'),
    side: request.side,
    type: request.type,
    qty,
    ...(isPrice(request.limitCents) ? { limitCents: request.limitCents } : {}),
    ...(isPrice(request.stopCents) ? { stopCents: request.stopCents } : {}),
    status: 'working',
    createdAt: quote.timeMs,
    ...(request.reduceOnly ? { reduceOnly: true } : {}),
    ...(request.tag ? { tag: request.tag } : {}),
    ...(request.takeProfitCents !== undefined || request.stopLossCents !== undefined
      ? {
          bracket: {
            ...(request.takeProfitCents !== undefined
              ? { takeProfitCents: request.takeProfitCents }
              : {}),
            ...(request.stopLossCents !== undefined ? { stopLossCents: request.stopLossCents } : {}),
          },
        }
      : {}),
  };

  const withOrder: Account = { ...account, orders: [...account.orders, order] };

  if (marketableLimit) {
    // It crosses the spread, so it takes liquidity straight away — at the
    // market price, but never worse than the limit the user asked for.
    const raw = fillPrice(request.side, qty, quote, account.settings);
    const limit = request.limitCents as Cents;
    const price = request.side === 'buy' ? Math.min(raw, limit) : Math.max(raw, limit);
    const booked = bookFill(withOrder, order, price, account.settings.takerFeePpm, quote);
    let next = booked.account;
    if (order.bracket) next = attachBrackets(next, order.bracket, quote.timeMs);
    return {
      account: next,
      order: next.orders.find((o) => o.id === order.id) ?? order,
      executions: booked.execution ? [booked.execution] : [],
    };
  }

  return { account: withOrder, order, executions: [] };
}

function isPrice(value: Cents | undefined): value is Cents {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function rejection(request: OrderRequest, reason: string, now: number): Order {
  return {
    id: nextId('o'),
    side: request.side,
    type: request.type,
    qty: Math.abs(request.qty),
    status: 'rejected',
    createdAt: now,
    reason,
  };
}

function reject(
  account: Account,
  request: OrderRequest,
  reason: string,
  now: number,
): SubmitOrderResult {
  return { account, order: rejection(request, reason, now), executions: [], rejected: reason };
}

/**
 * Create the exit orders for a position that has just been opened.
 *
 * The two exits share an OCO group, so whichever triggers first cancels the
 * other. Both are reduce-only: they can close the position but never flip it.
 */
export function attachBrackets(
  account: Account,
  request: { takeProfitCents?: Cents; stopLossCents?: Cents },
  now: number,
): Account {
  const qty = Math.abs(account.position.qty);
  if (qty === 0) return account;
  const exitSide: Side = account.position.qty > 0 ? 'sell' : 'buy';
  const group = nextId('oco');
  const added: Order[] = [];

  if (isPrice(request.takeProfitCents)) {
    added.push({
      id: nextId('o'),
      side: exitSide,
      type: 'limit',
      qty,
      limitCents: request.takeProfitCents,
      status: 'working',
      createdAt: now,
      ocoGroup: group,
      reduceOnly: true,
      tag: 'tp',
    });
  }
  if (isPrice(request.stopLossCents)) {
    added.push({
      id: nextId('o'),
      side: exitSide,
      type: 'stop',
      qty,
      stopCents: request.stopLossCents,
      status: 'working',
      createdAt: now,
      ocoGroup: group,
      reduceOnly: true,
      tag: 'sl',
    });
  }
  if (added.length === 0) return account;
  // Replace any exits already attached, so setting a new bracket is not
  // additive — a position has one take-profit and one stop-loss.
  const kept = account.orders.filter((o) => !(o.status === 'working' && o.tag && o.reduceOnly));
  return { ...account, orders: [...kept, ...added] };
}

export function cancelOrder(account: Account, id: string): Account {
  return {
    ...account,
    orders: account.orders.map((o) =>
      o.id === id && o.status === 'working' ? { ...o, status: 'cancelled' } : o,
    ),
  };
}

export function cancelAllOrders(account: Account): Account {
  return {
    ...account,
    orders: account.orders.map((o) => (o.status === 'working' ? { ...o, status: 'cancelled' } : o)),
  };
}

/** Move a working order's price. */
export function modifyOrder(
  account: Account,
  id: string,
  patch: { limitCents?: Cents; stopCents?: Cents },
): Account {
  return {
    ...account,
    orders: account.orders.map((o) => {
      if (o.id !== id || o.status !== 'working') return o;
      const next = { ...o };
      if (patch.limitCents !== undefined && isPrice(patch.limitCents)) {
        next.limitCents = patch.limitCents;
      }
      if (patch.stopCents !== undefined && isPrice(patch.stopCents)) {
        next.stopCents = patch.stopCents;
      }
      return next;
    }),
  };
}

export interface ProcessResult {
  account: Account;
  executions: Execution[];
  /** Orders cancelled because their sibling filled or the position flattened. */
  cancelled: Order[];
}

/**
 * Work through the resting orders against a new price.
 *
 * `range` is the span the price covered since the previous tick, so an order is
 * filled when the market traded through it even if no tick landed exactly on
 * its price. Orders are processed oldest first, and each fill re-checks the
 * ones after it — a stop-loss that triggers on the same tick as its
 * take-profit must not both fill.
 */
export function processOrders(
  account: Account,
  quote: Quote,
  range: PriceRange,
): ProcessResult {
  let current = account;
  const executions: Execution[] = [];
  const cancelled: Order[] = [];

  // A snapshot of the ids to consider, so orders created by this pass (none
  // today, but brackets could) are not processed in the same tick.
  const queue = account.orders.filter((o) => o.status === 'working').map((o) => o.id);

  for (const id of queue) {
    const order = current.orders.find((o) => o.id === id);
    if (!order || order.status !== 'working') continue;

    if (order.reduceOnly && current.position.qty === 0) {
      current = cancelOrder(current, order.id);
      cancelled.push(order);
      continue;
    }

    const trigger = evaluate(order, range);
    if (!trigger.fills) {
      if (trigger.triggered && !order.triggered) {
        // A stop-limit that has been hit becomes a resting limit order.
        current = {
          ...current,
          orders: current.orders.map((o) => (o.id === order.id ? { ...o, triggered: true } : o)),
        };
      }
      continue;
    }

    const filled = fillWorkingOrder(current, order, quote, trigger.priceCents);
    current = filled.account;
    if (filled.execution) executions.push(filled.execution);

    // OCO: pull the sibling as soon as one side is done.
    if (order.ocoGroup) {
      for (const sibling of current.orders) {
        if (
          sibling.ocoGroup === order.ocoGroup &&
          sibling.id !== order.id &&
          sibling.status === 'working'
        ) {
          current = cancelOrder(current, sibling.id);
          cancelled.push(sibling);
        }
      }
    }

    // Attach this entry's brackets now that there is a position to protect.
    if (order.bracket) {
      current = attachBrackets(current, order.bracket, quote.timeMs);
    }

    // A fill that flattened the position takes every reduce-only order with it.
    if (current.position.qty === 0) {
      for (const other of current.orders) {
        if (other.status === 'working' && other.reduceOnly) {
          current = cancelOrder(current, other.id);
          cancelled.push(other);
        }
      }
    }
  }

  return { account: current, executions, cancelled };
}

interface Trigger {
  fills: boolean;
  /** Price the fill happens at, when it fills. */
  priceCents: Cents;
  /** True when a stop-limit's trigger has been reached. */
  triggered: boolean;
}

/**
 * Decide whether an order fills against this price move.
 *
 * A resting limit fills at its own price once the market trades through it.
 * Stops trigger on the last price — the convention everywhere — and then fill
 * at market, so they take slippage exactly as a manual market order would.
 */
function evaluate(order: Order, range: PriceRange): Trigger {
  const none: Trigger = { fills: false, priceCents: 0, triggered: false };

  if (order.type === 'limit') {
    const limit = order.limitCents;
    if (!isPrice(limit)) return none;
    const crossed = order.side === 'buy' ? range.lowCents <= limit : range.highCents >= limit;
    if (!crossed) return none;
    // A resting order gets its own price. It was already in the book when the
    // market reached it, so a gap straight through does not improve the fill —
    // and it certainly does not worsen it.
    return { fills: true, priceCents: limit, triggered: false };
  }

  if (order.type === 'stop') {
    const stop = order.stopCents;
    if (!isPrice(stop)) return none;
    const hit = order.side === 'buy' ? range.highCents >= stop : range.lowCents <= stop;
    if (!hit) return none;
    return { fills: true, priceCents: 0, triggered: true };
  }

  if (order.type === 'stopLimit') {
    const stop = order.stopCents;
    const limit = order.limitCents;
    if (!isPrice(stop) || !isPrice(limit)) return none;
    const triggered =
      order.triggered === true ||
      (order.side === 'buy' ? range.highCents >= stop : range.lowCents <= stop);
    if (!triggered) return none;
    const crossed = order.side === 'buy' ? range.lowCents <= limit : range.highCents >= limit;
    if (!crossed) return { fills: false, priceCents: 0, triggered: true };
    return { fills: true, priceCents: limit, triggered: true };
  }

  return none;
}

interface FillResult {
  account: Account;
  execution: Execution | null;
}

/**
 * Book a working order.
 *
 * A stop fills at market and pays the taker fee; a limit fills at its own
 * price and pays the maker fee, because it was the resting side of the trade.
 */
function fillWorkingOrder(
  account: Account,
  order: Order,
  quote: Quote,
  limitPriceCents: Cents,
): FillResult {
  const isStopToMarket = order.type === 'stop';
  const price = isStopToMarket
    ? fillPrice(order.side, order.qty, quote, account.settings)
    : limitPriceCents;
  const feePpm = isStopToMarket ? account.settings.takerFeePpm : account.settings.makerFeePpm;
  return bookFill(account, order, price, feePpm, quote);
}

/**
 * Book a fill for an order already sitting in the account.
 *
 * Shared by the resting path and by a limit that crossed the spread on
 * arrival, so both go through exactly the same position and cash arithmetic.
 */
function bookFill(
  account: Account,
  order: Order,
  price: Cents,
  feePpm: number,
  quote: Quote,
): FillResult {
  // Reduce-only can never overshoot into a position the other way round.
  const qty = order.reduceOnly
    ? Math.min(order.qty, Math.abs(account.position.qty))
    : order.qty;
  if (qty <= 0) {
    return { account: cancelOrder(account, order.id), execution: null };
  }

  const { position, realisedCents } = applyFill(
    account.position,
    order.side,
    qty,
    price,
    quote.timeMs,
  );
  const feeCents = applyPpm(Math.abs(notional(price, qty)), feePpm);

  const execution: Execution = {
    id: nextId('x'),
    orderId: order.id,
    time: quote.timeMs,
    side: order.side,
    qty,
    priceCents: price,
    feeCents,
    realisedCents,
  };

  return {
    account: {
      ...account,
      balanceCents: account.balanceCents + realisedCents - feeCents,
      position,
      orders: account.orders.map((o) =>
        o.id === order.id
          ? { ...o, status: 'filled', filledAt: quote.timeMs, fillPriceCents: price, feeCents, qty }
          : o,
      ),
      executions: [...account.executions, execution],
      realisedPnlCents: account.realisedPnlCents + realisedCents,
      feesCents: account.feesCents + feeCents,
    },
    execution,
  };
}

/** Sensible default exit prices for a position, used by the TP/SL buttons. */
export function defaultBracketPrices(
  entryCents: Cents,
  qty: number,
  rewardFraction = 0.02,
): { takeProfitCents: Cents; stopLossCents: Cents } {
  const long = qty > 0;
  const reward = Math.round(entryCents * rewardFraction);
  return {
    takeProfitCents: long ? entryCents + reward : Math.max(1, entryCents - reward),
    stopLossCents: long ? Math.max(1, entryCents - Math.round(reward / 2)) : entryCents + Math.round(reward / 2),
  };
}

/** Exported so the store can keep the helper's sign conventions in one place. */
export { sideSign };

import { notional, qtyToUnits, QTY_SCALE, type Cents, type Qty } from './money';
import type { Execution } from './types';

/**
 * A completed round trip: from flat, through a position, back to flat.
 *
 * Derived from the execution list rather than recorded separately, so the
 * journal can never disagree with the order history — and so it survives any
 * change to how orders are placed.
 */
export interface Trip {
  /** The id of the execution that opened it, so notes can be keyed stably. */
  id: string;
  direction: 'long' | 'short';
  openedAt: number;
  closedAt: number;
  /** Largest size the position reached, in micro-units. */
  qty: Qty;
  avgEntryCents: Cents;
  avgExitCents: Cents;
  /** Realised profit or loss before commission. */
  grossCents: Cents;
  feesCents: Cents;
  /** Realised profit or loss after commission — what actually landed. */
  netCents: Cents;
  /** How long the position was open, in milliseconds. */
  durationMs: number;
  /** True when a forced liquidation closed it. */
  liquidated: boolean;
  /** How many fills the trip took. */
  fills: number;
}

/**
 * Split an execution stream into round trips.
 *
 * Walks the fills tracking net position, opening a trip when the position
 * leaves flat and closing it when it returns. A reversal passes through flat,
 * so the same execution closes one trip and opens the next — which is exactly
 * how a trader would describe it.
 */
export function buildTrips(executions: Execution[]): Trip[] {
  const trips: Trip[] = [];

  let qty = 0;
  let open: {
    id: string;
    openedAt: number;
    direction: 'long' | 'short';
    peakQty: Qty;
    entryQty: Qty;
    entryNotional: Cents;
    exitQty: Qty;
    exitNotional: Cents;
    gross: Cents;
    fees: Cents;
    fills: number;
    liquidated: boolean;
  } | null = null;

  const finish = (closedAt: number): void => {
    if (!open) return;
    const avgEntry =
      open.entryQty > 0 ? Math.round((open.entryNotional * QTY_SCALE) / open.entryQty) : 0;
    const avgExit = open.exitQty > 0 ? Math.round((open.exitNotional * QTY_SCALE) / open.exitQty) : 0;
    trips.push({
      id: open.id,
      direction: open.direction,
      openedAt: open.openedAt,
      closedAt,
      qty: open.peakQty,
      avgEntryCents: avgEntry,
      avgExitCents: avgExit,
      grossCents: open.gross,
      feesCents: open.fees,
      netCents: open.gross - open.fees,
      durationMs: Math.max(0, closedAt - open.openedAt),
      liquidated: open.liquidated,
      fills: open.fills,
    });
    open = null;
  };

  for (const execution of executions) {
    const signed = execution.side === 'buy' ? execution.qty : -execution.qty;

    if (qty === 0) {
      open = {
        id: execution.id,
        openedAt: execution.time,
        direction: signed > 0 ? 'long' : 'short',
        peakQty: Math.abs(signed),
        entryQty: Math.abs(signed),
        entryNotional: Math.abs(notional(execution.priceCents, signed)),
        exitQty: 0,
        exitNotional: 0,
        gross: 0,
        fees: execution.feeCents,
        fills: 1,
        liquidated: execution.system === true,
      };
      qty = signed;
      continue;
    }

    if (!open) {
      // Defensive: a stream that starts mid-position has nothing to attribute
      // the fill to, so treat it as a fresh open.
      qty += signed;
      continue;
    }

    const closing = Math.sign(signed) !== Math.sign(qty);
    if (!closing) {
      open.entryQty += Math.abs(signed);
      open.entryNotional += Math.abs(notional(execution.priceCents, signed));
      open.peakQty = Math.max(open.peakQty, Math.abs(qty + signed));
      open.fees += execution.feeCents;
      open.fills += 1;
      qty += signed;
      continue;
    }

    const closedQty = Math.min(Math.abs(qty), Math.abs(signed));
    open.exitQty += closedQty;
    open.exitNotional += Math.abs(notional(execution.priceCents, closedQty));
    open.gross += execution.realisedCents;
    open.fees += execution.feeCents;
    open.fills += 1;
    if (execution.system) open.liquidated = true;

    const next = qty + signed;
    if (next === 0) {
      finish(execution.time);
      qty = 0;
      continue;
    }
    if (Math.sign(next) === Math.sign(qty)) {
      // Partial close: the trip stays open.
      qty = next;
      continue;
    }
    // Reversal: this fill closes one trip and opens the opposite one.
    finish(execution.time);
    const remainder = next;
    open = {
      id: `${execution.id}-r`,
      openedAt: execution.time,
      direction: remainder > 0 ? 'long' : 'short',
      peakQty: Math.abs(remainder),
      entryQty: Math.abs(remainder),
      entryNotional: Math.abs(notional(execution.priceCents, remainder)),
      exitQty: 0,
      exitNotional: 0,
      gross: 0,
      fees: 0,
      fills: 1,
      liquidated: false,
    };
    qty = remainder;
  }

  return trips;
}

export interface TradeStats {
  trips: number;
  wins: number;
  losses: number;
  /** Fraction between 0 and 1. */
  winRate: number;
  avgWinCents: Cents;
  avgLossCents: Cents;
  largestWinCents: Cents;
  largestLossCents: Cents;
  grossProfitCents: Cents;
  grossLossCents: Cents;
  /** Gross profit divided by gross loss; Infinity when there are no losses. */
  profitFactor: number;
  /** Average result per trip, in cents. */
  expectancyCents: Cents;
  netCents: Cents;
  feesCents: Cents;
  /** Deepest fall from a peak on the cumulative curve, in cents. */
  maxDrawdownCents: Cents;
  /** Longest run of winners and of losers. */
  bestStreak: number;
  worstStreak: number;
  totalDurationMs: number;
}

export const EMPTY_STATS: TradeStats = {
  trips: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  avgWinCents: 0,
  avgLossCents: 0,
  largestWinCents: 0,
  largestLossCents: 0,
  grossProfitCents: 0,
  grossLossCents: 0,
  profitFactor: 0,
  expectancyCents: 0,
  netCents: 0,
  feesCents: 0,
  maxDrawdownCents: 0,
  bestStreak: 0,
  worstStreak: 0,
  totalDurationMs: 0,
};

/**
 * Summary statistics over a set of round trips.
 *
 * A trip that ends exactly flat counts as neither a win nor a loss, so the win
 * rate is wins over trips rather than wins over wins-plus-losses — the same
 * convention a broker statement uses.
 */
export function tradeStats(trips: Trip[]): TradeStats {
  if (trips.length === 0) return EMPTY_STATS;

  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let net = 0;
  let fees = 0;
  let duration = 0;
  let peak = 0;
  let cumulative = 0;
  let maxDrawdown = 0;
  let streak = 0;
  let bestStreak = 0;
  let worstStreak = 0;

  for (const trip of trips) {
    net += trip.netCents;
    fees += trip.feesCents;
    duration += trip.durationMs;

    if (trip.netCents > 0) {
      wins += 1;
      grossProfit += trip.netCents;
      if (trip.netCents > largestWin) largestWin = trip.netCents;
      streak = streak > 0 ? streak + 1 : 1;
      if (streak > bestStreak) bestStreak = streak;
    } else if (trip.netCents < 0) {
      losses += 1;
      grossLoss += -trip.netCents;
      if (trip.netCents < largestLoss) largestLoss = trip.netCents;
      streak = streak < 0 ? streak - 1 : -1;
      if (-streak > worstStreak) worstStreak = -streak;
    } else {
      streak = 0;
    }

    cumulative += trip.netCents;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return {
    trips: trips.length,
    wins,
    losses,
    winRate: wins / trips.length,
    avgWinCents: wins > 0 ? Math.round(grossProfit / wins) : 0,
    avgLossCents: losses > 0 ? -Math.round(grossLoss / losses) : 0,
    largestWinCents: largestWin,
    largestLossCents: largestLoss,
    grossProfitCents: grossProfit,
    grossLossCents: grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
    expectancyCents: Math.round(net / trips.length),
    netCents: net,
    feesCents: fees,
    maxDrawdownCents: maxDrawdown,
    bestStreak,
    worstStreak,
    totalDurationMs: duration,
  };
}

/** Cumulative net result after each trip, for the equity curve. */
export function equityCurve(trips: Trip[], startingCents: Cents): Cents[] {
  const points: Cents[] = [startingCents];
  let running = startingCents;
  for (const trip of trips) {
    running += trip.netCents;
    points.push(running);
  }
  return points;
}

/** Size in DAVID, for display. */
export function tripUnits(trip: Trip): number {
  return qtyToUnits(trip.qty);
}

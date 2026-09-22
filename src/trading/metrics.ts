import {
  averageEntry,
  liquidationPrice,
  maintenanceMargin,
  positionNotional,
  requiredMargin,
  unrealisedPnl,
} from './engine';
import { tickValue, type Cents } from './money';
import type { Account, Quote } from './types';

/** Everything the summary row and the order panel need, derived in one place. */
export interface AccountMetrics {
  balanceCents: Cents;
  equityCents: Cents;
  realisedPnlCents: Cents;
  unrealisedPnlCents: Cents;
  feesCents: Cents;
  /** Margin backing the open position. */
  positionMarginCents: Cents;
  /** Margin reserved by working orders. */
  ordersMarginCents: Cents;
  availableCents: Cents;
  maintenanceMarginCents: Cents;
  /**
   * How far equity is above the maintenance requirement, as a fraction of
   * equity. 1 means nothing at risk; 0 means liquidation.
   */
  marginBuffer: number;
  positionNotionalCents: Cents;
  averageEntryCents: Cents;
  liquidationCents: Cents | null;
  tickValueCents: Cents;
}

export function accountMetrics(account: Account, quote: Quote, tickCents = 1): AccountMetrics {
  const { position, settings } = account;
  const mark = quote.lastCents;
  const unrealised = unrealisedPnl(position, mark);
  const equity = account.balanceCents + unrealised;
  const positionMargin = requiredMargin(position, mark, settings);
  const ordersMargin = workingOrdersMargin(account, mark);
  const maintenance = maintenanceMargin(position, mark, settings);

  return {
    balanceCents: account.balanceCents,
    equityCents: equity,
    realisedPnlCents: account.realisedPnlCents,
    unrealisedPnlCents: unrealised,
    feesCents: account.feesCents,
    positionMarginCents: positionMargin,
    ordersMarginCents: ordersMargin,
    availableCents: equity - positionMargin - ordersMargin,
    maintenanceMarginCents: maintenance,
    marginBuffer: equity > 0 ? Math.max(0, (equity - maintenance) / equity) : 0,
    positionNotionalCents: positionNotional(position, mark),
    averageEntryCents: averageEntry(position),
    liquidationCents: liquidationPrice(position, account.balanceCents, settings),
    tickValueCents: tickValue(position.qty, tickCents),
  };
}

/**
 * Margin set aside for orders that have not filled.
 *
 * Only orders that would grow the position tie up margin; one that reduces it
 * frees margin instead, so it is not counted.
 */
export function workingOrdersMargin(account: Account, markCents: Cents): Cents {
  const lev = Math.max(1, account.settings.leverage);
  let total = 0;
  for (const order of account.orders) {
    if (order.status !== 'working') continue;
    const signed = order.side === 'buy' ? order.qty : -order.qty;
    if (account.position.qty !== 0 && Math.sign(signed) !== Math.sign(account.position.qty)) continue;
    const reference = order.limitCents ?? order.stopCents ?? markCents;
    total += Math.ceil(Math.abs((reference * order.qty) / 1_000_000) / lev);
  }
  return total;
}

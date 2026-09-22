import type { Cents, Qty } from './money';

export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stopLimit';
export type OrderStatus = 'working' | 'filled' | 'cancelled' | 'rejected';

export interface AccountSettings {
  /** Cash the account starts with, and returns to on reset. */
  startingBalanceCents: Cents;
  /** 1 to 125. Initial margin is notional divided by this. */
  leverage: number;
  /** Commission for orders that rest in the book, in parts per million. */
  makerFeePpm: number;
  /** Commission for orders that take liquidity, in parts per million. */
  takerFeePpm: number;
  /** Fraction of notional that must remain as equity, in parts per million. */
  maintenanceMarginPpm: number;
  /** When off, market orders fill exactly at the quote. */
  slippage: boolean;
  /** When off, both sides trade at the last price instead of bid/ask. */
  spread: boolean;
}

export interface Position {
  /** Signed micro-units: positive is long, negative is short. */
  qty: Qty;
  /**
   * Signed cost of the open quantity, in cents.
   *
   * Tracking the total rather than an average price means reducing a position
   * cannot accumulate rounding error in the entry price.
   */
  entryNotionalCents: Cents;
  /** When the current position was opened, for the journal. */
  openedAt: number;
}

export const FLAT_POSITION: Position = { qty: 0, entryNotionalCents: 0, openedAt: 0 };

export interface Order {
  id: string;
  side: Side;
  type: OrderType;
  qty: Qty;
  /** Limit price, for limit and stop-limit orders. */
  limitCents?: Cents;
  /** Trigger price, for stop and stop-limit orders. */
  stopCents?: Cents;
  status: OrderStatus;
  createdAt: number;
  filledAt?: number;
  /** Price actually obtained, including slippage. */
  fillPriceCents?: Cents;
  feeCents?: Cents;
  /** Why the order was rejected, if it was. */
  reason?: string;
  /** True when the engine created this order itself, e.g. a liquidation. */
  system?: boolean;
  /**
   * Orders that cancel each other.
   *
   * A take-profit and its stop-loss share a group: whichever fills first, the
   * other is pulled. That is the whole of OCO.
   */
  ocoGroup?: string;
  /** Never grows the position; cancelled outright once the position is flat. */
  reduceOnly?: boolean;
  /** Bracket exits to attach once this entry fills. */
  bracket?: { takeProfitCents?: Cents; stopLossCents?: Cents };
  /** Set on a stop-limit once its trigger has been hit. */
  triggered?: boolean;
  /** Human label for the chart, e.g. "TP" or "SL". */
  tag?: 'tp' | 'sl';
}

/** What the UI asks the engine to do. */
export interface OrderRequest {
  side: Side;
  type: OrderType;
  qty: Qty;
  limitCents?: Cents;
  stopCents?: Cents;
  takeProfitCents?: Cents;
  stopLossCents?: Cents;
  reduceOnly?: boolean;
  tag?: 'tp' | 'sl';
}

/** The price range covered since the previous tick, for crossing tests. */
export interface PriceRange {
  lowCents: Cents;
  highCents: Cents;
}

export interface Execution {
  id: string;
  orderId: string;
  time: number;
  side: Side;
  qty: Qty;
  priceCents: Cents;
  feeCents: Cents;
  /** Realised profit or loss booked by this execution. */
  realisedCents: Cents;
  system?: boolean;
}

export interface Account {
  id: string;
  name: string;
  settings: AccountSettings;
  /** Realised cash, in cents. */
  balanceCents: Cents;
  position: Position;
  orders: Order[];
  executions: Execution[];
  /** Cumulative realised profit and loss, for the summary row. */
  realisedPnlCents: Cents;
  /** Cumulative commission paid. */
  feesCents: Cents;
  /** Free-text notes against a round trip, keyed by its id. */
  notes: Record<string, string>;
  createdAt: number;
}

/** A live quote, as the order panel and the engine see it. */
export interface Quote {
  timeMs: number;
  lastCents: Cents;
  bidCents: Cents;
  askCents: Cents;
  /** Volatility relative to typical, used to scale slippage. */
  volFactor: number;
}

export const DEFAULT_SETTINGS: AccountSettings = {
  startingBalanceCents: 10_000_000, // $100,000
  leverage: 10,
  makerFeePpm: 200, // 0.02%
  takerFeePpm: 550, // 0.055%
  maintenanceMarginPpm: 5_000, // 0.5%
  slippage: true,
  spread: true,
};

export const MIN_LEVERAGE = 1;
export const MAX_LEVERAGE = 125;

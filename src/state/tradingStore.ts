import { create } from 'zustand';
import { loadLocal, saveLocal } from '@/storage/local';
import {
  checkLiquidation,
  createAccount,
  resetAccount,
  submitMarketOrder,
} from '@/trading/engine';
import { centsToDollars, qtyToUnits, type Cents, type Qty } from '@/trading/money';
import {
  DEFAULT_SETTINGS,
  MAX_LEVERAGE,
  MIN_LEVERAGE,
  type Account,
  type AccountSettings,
  type Quote,
  type Side,
} from '@/trading/types';
import { notify } from './notifications';

const LS_KEY = 'trading';
/**
 * How much history each account keeps.
 *
 * Executions accumulate for as long as an account is used, and everything here
 * is written to localStorage; a cap keeps that bounded without the user ever
 * noticing, since the journal and statistics only need recent activity.
 */
const HISTORY_LIMIT = 500;

interface Persisted {
  accounts: Account[];
  activeId: string;
}

export interface TradingState {
  accounts: Account[];
  activeId: string;
  /** Set while a liquidation notice is showing, so it is only reported once. */
  lastLiquidationAt: number;

  active: () => Account;
  submitMarket: (side: Side, qty: Qty, quote: Quote) => void;
  closePosition: (quote: Quote) => void;
  reversePosition: (quote: Quote) => void;
  updateSettings: (patch: Partial<AccountSettings>) => void;
  reset: () => void;
  /** Called on every tick; closes the position if equity has run out. */
  markToMarket: (quote: Quote) => void;
}

function trim(account: Account): Account {
  if (account.orders.length <= HISTORY_LIMIT && account.executions.length <= HISTORY_LIMIT) {
    return account;
  }
  return {
    ...account,
    orders: account.orders.slice(-HISTORY_LIMIT),
    executions: account.executions.slice(-HISTORY_LIMIT),
  };
}

/**
 * Rebuild accounts from a saved payload, filling in anything missing.
 *
 * A saved account outlives code changes, and a setting that did not exist when
 * it was written must not come back as undefined and quietly break the margin
 * maths.
 */
function sanitise(raw: unknown, now: number): Persisted {
  const fallback = (): Persisted => {
    const account = createAccount('main', 'Main', { ...DEFAULT_SETTINGS }, now);
    return { accounts: [account], activeId: account.id };
  };
  if (typeof raw !== 'object' || raw === null) return fallback();
  const data = raw as Partial<Persisted>;
  if (!Array.isArray(data.accounts) || data.accounts.length === 0) return fallback();

  const accounts: Account[] = [];
  for (const item of data.accounts) {
    if (typeof item !== 'object' || item === null) continue;
    const a = item as Partial<Account>;
    if (typeof a.id !== 'string') continue;
    accounts.push({
      id: a.id,
      name: typeof a.name === 'string' ? a.name : 'Account',
      settings: { ...DEFAULT_SETTINGS, ...(a.settings ?? {}) },
      balanceCents: Number.isFinite(a.balanceCents)
        ? (a.balanceCents as number)
        : DEFAULT_SETTINGS.startingBalanceCents,
      position:
        a.position && Number.isFinite(a.position.qty)
          ? a.position
          : { qty: 0, entryNotionalCents: 0, openedAt: 0 },
      orders: Array.isArray(a.orders) ? a.orders : [],
      executions: Array.isArray(a.executions) ? a.executions : [],
      realisedPnlCents: Number.isFinite(a.realisedPnlCents) ? (a.realisedPnlCents as number) : 0,
      feesCents: Number.isFinite(a.feesCents) ? (a.feesCents as number) : 0,
      createdAt: Number.isFinite(a.createdAt) ? (a.createdAt as number) : now,
    });
  }
  if (accounts.length === 0) return fallback();
  const activeId = accounts.some((a) => a.id === data.activeId)
    ? (data.activeId as string)
    : (accounts[0] as Account).id;
  return { accounts, activeId };
}

const initial = sanitise(loadLocal<unknown>(LS_KEY, null), Date.now());

export const useTrading = create<TradingState>((set, get) => {
  const persist = (): void => {
    const s = get();
    saveLocal(LS_KEY, { accounts: s.accounts, activeId: s.activeId } satisfies Persisted);
  };

  const replace = (next: Account): void => {
    set({ accounts: get().accounts.map((a) => (a.id === next.id ? trim(next) : a)) });
    persist();
  };

  return {
    accounts: initial.accounts,
    activeId: initial.activeId,
    lastLiquidationAt: 0,

    active: () => {
      const s = get();
      return (s.accounts.find((a) => a.id === s.activeId) ?? s.accounts[0]) as Account;
    },

    submitMarket: (side, qty, quote) => {
      const account = get().active();
      const result = submitMarketOrder(account, side, qty, quote);
      if (result.order.status === 'rejected') {
        notify({
          tone: 'error',
          title: 'Order rejected',
          body: result.order.reason ?? 'The order could not be filled.',
        });
        return;
      }
      replace(result.account);
      const price = result.order.fillPriceCents ?? quote.lastCents;
      notify({
        tone: side === 'buy' ? 'success' : 'info',
        title: `${side === 'buy' ? 'Bought' : 'Sold'} ${qtyToUnits(result.order.qty)} DAVID`,
        body: `at $${centsToDollars(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      });
    },

    closePosition: (quote) => {
      const account = get().active();
      const qty = account.position.qty;
      if (qty === 0) return;
      get().submitMarket(qty > 0 ? 'sell' : 'buy', Math.abs(qty), quote);
    },

    reversePosition: (quote) => {
      const account = get().active();
      const qty = account.position.qty;
      if (qty === 0) return;
      // Twice the size takes it through flat and out the other side.
      get().submitMarket(qty > 0 ? 'sell' : 'buy', Math.abs(qty) * 2, quote);
    },

    updateSettings: (patch) => {
      const account = get().active();
      const settings: AccountSettings = { ...account.settings, ...patch };
      settings.leverage = Math.min(MAX_LEVERAGE, Math.max(MIN_LEVERAGE, Math.round(settings.leverage)));
      const next: Account = { ...account, settings };
      // Changing the starting balance only means anything while flat and
      // untouched, so it also resets the cash in that case.
      if (
        patch.startingBalanceCents !== undefined &&
        account.position.qty === 0 &&
        account.executions.length === 0
      ) {
        next.balanceCents = settings.startingBalanceCents;
      }
      replace(next);
    },

    reset: () => {
      replace(resetAccount(get().active()));
      notify({ tone: 'info', title: 'Account reset' });
    },

    markToMarket: (quote) => {
      const account = get().active();
      if (account.position.qty === 0) return;
      const result = checkLiquidation(account, quote);
      if (!result.execution) return;
      replace(result.account);
      set({ lastLiquidationAt: quote.timeMs });
      notify({
        tone: 'error',
        title: 'Position liquidated',
        body: `Equity fell below the maintenance requirement. ${qtyToUnits(
          result.execution.qty,
        )} DAVID closed at $${centsToDollars(result.execution.priceCents).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}.`,
      });
    },
  };
});

/** Cents formatted as a plain dollar amount, for notice text. */
export function formatUsd(cents: Cents): string {
  return centsToDollars(cents).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

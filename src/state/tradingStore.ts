import { create } from 'zustand';
import { loadLocal, saveLocal } from '@/storage/local';
import { checkLiquidation, createAccount, resetAccount } from '@/trading/engine';
import {
  attachBrackets,
  cancelAllOrders,
  cancelOrder as cancelOrderIn,
  modifyOrder as modifyOrderIn,
  processOrders,
  submitOrder as submitOrderIn,
} from '@/trading/orders';
import { centsToDollars, qtyToUnits, type Cents, type Qty } from '@/trading/money';
import {
  DEFAULT_SETTINGS,
  MAX_LEVERAGE,
  MIN_LEVERAGE,
  type Account,
  type AccountSettings,
  type OrderRequest,
  type Quote,
  type Side,
} from '@/trading/types';
import { notify } from './notifications';
import { playFillTone, speak, useAlerts } from './alertsStore';

/**
 * Announce a fill: a toast always, plus a tone and a spoken line if the user
 * has asked for them. Kept in one place so every route to a fill — market,
 * limit, stop, bracket or liquidation — sounds the same.
 */
function announceFill(title: string, body: string, buy: boolean, tone: 'success' | 'info' | 'warning' | 'error'): void {
  notify({ tone, title, body });
  const prefs = useAlerts.getState();
  if (prefs.fillSound) playFillTone(buy);
  if (prefs.announceFills) speak(title);
}

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
  addAccount: (name: string) => void;
  renameAccount: (id: string, name: string) => void;
  deleteAccount: (id: string) => void;
  selectAccount: (id: string) => void;
  setNote: (tripId: string, note: string) => void;
  submit: (request: OrderRequest, quote: Quote) => void;
  submitMarket: (side: Side, qty: Qty, quote: Quote) => void;
  closePosition: (quote: Quote) => void;
  reversePosition: (quote: Quote) => void;
  cancelOrder: (id: string) => void;
  cancelAll: () => void;
  moveOrder: (id: string, priceCents: Cents) => void;
  setBrackets: (patch: { takeProfitCents?: Cents; stopLossCents?: Cents }) => void;
  updateSettings: (patch: Partial<AccountSettings>) => void;
  reset: () => void;
  /**
   * Called on every tick: works the resting orders against the new price, then
   * liquidates if equity has run out.
   */
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
      notes: typeof a.notes === 'object' && a.notes !== null ? a.notes : {},
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

/**
 * The last price the store saw.
 *
 * Kept outside the store because it is not state anyone renders — it exists
 * only so a tick can describe the range it covered since the previous one.
 */
let previousPriceCents = 0;

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

    addAccount: (name) => {
      const id = `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      // A new account starts from the current one's settings, which is almost
      // always what someone wants when they add a second one.
      const template = get().active().settings;
      const account = createAccount(id, name.trim() || 'Account', { ...template }, Date.now());
      set({ accounts: [...get().accounts, account], activeId: id });
      persist();
      notify({ tone: 'success', title: `Account "${account.name}" created` });
    },

    renameAccount: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      set({ accounts: get().accounts.map((a) => (a.id === id ? { ...a, name: trimmed } : a)) });
      persist();
    },

    deleteAccount: (id) => {
      const remaining = get().accounts.filter((a) => a.id !== id);
      // There is always at least one account to trade in.
      if (remaining.length === 0) return;
      const activeId = get().activeId === id ? (remaining[0] as Account).id : get().activeId;
      set({ accounts: remaining, activeId });
      persist();
      notify({ tone: 'info', title: 'Account deleted' });
    },

    selectAccount: (id) => {
      if (!get().accounts.some((a) => a.id === id)) return;
      set({ activeId: id });
      persist();
    },

    setNote: (tripId, note) => {
      const account = get().active();
      const notes = { ...account.notes };
      if (note.trim()) notes[tripId] = note;
      else delete notes[tripId];
      replace({ ...account, notes });
    },

    submit: (request, quote) => {
      const account = get().active();
      const result = submitOrderIn(account, request, quote);
      if (result.rejected) {
        notify({ tone: 'error', title: 'Order rejected', body: result.rejected });
        return;
      }
      replace(result.account);

      if (result.order.status === 'working') {
        notify({
          tone: 'info',
          title: `${request.side === 'buy' ? 'Buy' : 'Sell'} ${request.type} order placed`,
          body: `${qtyToUnits(result.order.qty)} DAVID at $${formatUsd(
            (result.order.limitCents ?? result.order.stopCents ?? quote.lastCents) as number,
          )}`,
        });
        return;
      }
      const price = result.order.fillPriceCents ?? quote.lastCents;
      announceFill(
        `Order filled: ${request.side === 'buy' ? 'bought' : 'sold'} ${qtyToUnits(result.order.qty)} DAVID`,
        `at $${formatUsd(price)}`,
        request.side === 'buy',
        request.side === 'buy' ? 'success' : 'info',
      );
    },

    submitMarket: (side, qty, quote) => {
      get().submit({ side, type: 'market', qty }, quote);
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

    cancelOrder: (id) => {
      const account = get().active();
      if (!account.orders.some((o) => o.id === id && o.status === 'working')) return;
      replace(cancelOrderIn(account, id));
      notify({ tone: 'info', title: 'Order cancelled' });
    },

    cancelAll: () => {
      const account = get().active();
      const count = account.orders.filter((o) => o.status === 'working').length;
      if (count === 0) return;
      replace(cancelAllOrders(account));
      notify({ tone: 'info', title: `${count} order${count === 1 ? '' : 's'} cancelled` });
    },

    moveOrder: (id, priceCents) => {
      const account = get().active();
      const order = account.orders.find((o) => o.id === id);
      if (!order || order.status !== 'working') return;
      // Which price to move depends on the order type: a stop-limit keeps its
      // limit where it is and its trigger is what the line represents.
      const patch =
        order.type === 'limit'
          ? { limitCents: priceCents }
          : { stopCents: priceCents };
      replace(modifyOrderIn(account, id, patch));
    },

    setBrackets: (patch) => {
      const account = get().active();
      if (account.position.qty === 0) return;
      replace(attachBrackets(account, patch, Date.now()));
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
      let account = get().active();
      const hasWork = account.orders.some((o) => o.status === 'working');

      if (hasWork) {
        // The range covered since the previous tick, so an order is filled
        // when the market traded through it even if no tick landed on it.
        const previous = previousPriceCents;
        const range = {
          lowCents: Math.min(previous || quote.lastCents, quote.lastCents),
          highCents: Math.max(previous || quote.lastCents, quote.lastCents),
        };
        const worked = processOrders(account, quote, range);
        if (worked.executions.length > 0 || worked.cancelled.length > 0) {
          replace(worked.account);
          account = worked.account;
          for (const execution of worked.executions) {
            const order = worked.account.orders.find((o) => o.id === execution.orderId);
            const label =
              order?.tag === 'tp'
                ? 'Take-profit filled'
                : order?.tag === 'sl'
                  ? 'Stop-loss filled'
                  : 'Order filled';
            announceFill(
              label,
              `${qtyToUnits(execution.qty)} DAVID at $${formatUsd(execution.priceCents)}`,
              execution.side === 'buy',
              execution.realisedCents >= 0 ? 'success' : 'warning',
            );
          }
        }
      }
      previousPriceCents = quote.lastCents;

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

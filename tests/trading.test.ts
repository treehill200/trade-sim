import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyFill,
  averageEntry,
  checkLiquidation,
  createAccount,
  fillPrice,
  liquidationPrice,
  maintenanceMargin,
  maxAffordableQty,
  previewMarketOrder,
  positionNotional,
  requiredMargin,
  resetAccount,
  resetIdSequence,
  submitMarketOrder,
  unrealisedPnl,
} from '@/trading/engine';
import { accountMetrics } from '@/trading/metrics';
import {
  applyPpm,
  dollarsToCents,
  notional,
  percentToPpm,
  qtyFromNotional,
  QTY_SCALE,
  roundToTick,
  tickValue,
  unitsToQty,
} from '@/trading/money';
import {
  DEFAULT_SETTINGS,
  FLAT_POSITION,
  type Account,
  type AccountSettings,
  type Quote,
} from '@/trading/types';

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

function quote(last: number, spread = 200, volFactor = 1): Quote {
  return {
    timeMs: T0,
    lastCents: last,
    bidCents: last - spread / 2,
    askCents: last + spread / 2,
    volFactor,
  };
}

function account(overrides: Partial<AccountSettings> = {}): Account {
  return createAccount('a1', 'Test', { ...DEFAULT_SETTINGS, ...overrides }, T0);
}

/** No spread, no slippage, no fees: isolates the arithmetic under test. */
const CLEAN: Partial<AccountSettings> = {
  spread: false,
  slippage: false,
  takerFeePpm: 0,
  makerFeePpm: 0,
};

beforeEach(() => resetIdSequence());

describe('money arithmetic', () => {
  it('computes notional exactly for fractional quantities', () => {
    // 0.5 DAVID at $40,000 is $20,000.
    expect(notional(4_000_000, QTY_SCALE / 2)).toBe(2_000_000);
    expect(notional(4_000_000, QTY_SCALE)).toBe(4_000_000);
    expect(notional(4_000_000, 3 * QTY_SCALE)).toBe(12_000_000);
  });

  it('stays exact for quantities large enough to break naive multiplication', () => {
    // 1,000 DAVID at $40,000.00 is $40,000,000 = 4e9 cents.
    expect(notional(4_000_000, 1_000 * QTY_SCALE)).toBe(4_000_000_000);
    expect(Number.isSafeInteger(notional(4_000_000, 1_000 * QTY_SCALE))).toBe(true);
  });

  it('is signed like the quantity', () => {
    expect(notional(4_000_000, -QTY_SCALE)).toBe(-4_000_000);
  });

  it('round-trips a notional back into a quantity', () => {
    const q = qtyFromNotional(2_000_000, 4_000_000);
    expect(q).toBe(QTY_SCALE / 2);
    expect(notional(4_000_000, q)).toBe(2_000_000);
  });

  it('never returns a quantity whose notional exceeds the budget', () => {
    for (const price of [1, 7, 4_000_001, 3_333_333]) {
      for (const budget of [1, 99, 100_000, 987_654_321]) {
        const q = qtyFromNotional(budget, price);
        expect(notional(price, q)).toBeLessThanOrEqual(budget);
      }
    }
  });

  it('converts percentages to parts per million', () => {
    expect(percentToPpm(0.02)).toBe(200);
    expect(percentToPpm(0.5)).toBe(5_000);
    expect(percentToPpm(100)).toBe(1_000_000);
  });

  it('applies a rate and rounds to the cent', () => {
    // 0.055% of $40,000 is $22.00.
    expect(applyPpm(4_000_000, 550)).toBe(2_200);
    expect(applyPpm(1_001, 500)).toBe(1); // 0.05% of $10.01 rounds to a cent
  });

  it('rounds prices to a tick', () => {
    expect(roundToTick(4_000_004, 1)).toBe(4_000_004);
    expect(roundToTick(4_000_004, 10)).toBe(4_000_000);
    expect(roundToTick(4_000_006, 10)).toBe(4_000_010);
  });

  it('parses user input into exact integers', () => {
    expect(unitsToQty(0.125)).toBe(125_000);
    expect(dollarsToCents(1234.56)).toBe(123_456);
    // The classic float trap: 0.1 + 0.2 worth of dollars.
    expect(dollarsToCents(0.1) + dollarsToCents(0.2)).toBe(30);
  });

  it('values a tick against a quantity', () => {
    // One cent of price on 2.5 DAVID is 2.5 cents, rounded to 3.
    expect(tickValue(unitsToQty(2.5), 1)).toBe(3);
    expect(tickValue(unitsToQty(100), 1)).toBe(100);
  });
});

describe('position arithmetic', () => {
  it('opens a long and reports its average entry', () => {
    const { position } = applyFill(FLAT_POSITION, 'buy', QTY_SCALE, 4_000_000, T0);
    expect(position.qty).toBe(QTY_SCALE);
    expect(averageEntry(position)).toBe(4_000_000);
    expect(position.openedAt).toBe(T0);
  });

  it('averages the entry when adding to a position', () => {
    let position = applyFill(FLAT_POSITION, 'buy', QTY_SCALE, 4_000_000, T0).position;
    position = applyFill(position, 'buy', QTY_SCALE, 4_200_000, T0).position;
    expect(position.qty).toBe(2 * QTY_SCALE);
    expect(averageEntry(position)).toBe(4_100_000);
  });

  it('books profit on the part that closes and keeps the rest', () => {
    const open = applyFill(FLAT_POSITION, 'buy', 2 * QTY_SCALE, 4_000_000, T0).position;
    const { position, realisedCents } = applyFill(open, 'sell', QTY_SCALE, 4_100_000, T0);
    // Sold 1 DAVID $1,000 higher than entry.
    expect(realisedCents).toBe(100_000);
    expect(position.qty).toBe(QTY_SCALE);
    expect(averageEntry(position)).toBe(4_000_000);
  });

  it('books loss on a short that moves against it', () => {
    const open = applyFill(FLAT_POSITION, 'sell', QTY_SCALE, 4_000_000, T0).position;
    const { position, realisedCents } = applyFill(open, 'buy', QTY_SCALE, 4_050_000, T0);
    expect(realisedCents).toBe(-50_000);
    expect(position.qty).toBe(0);
  });

  it('books profit on a short that moves in its favour', () => {
    const open = applyFill(FLAT_POSITION, 'sell', QTY_SCALE, 4_000_000, T0).position;
    const { realisedCents } = applyFill(open, 'buy', QTY_SCALE, 3_900_000, T0);
    expect(realisedCents).toBe(100_000);
  });

  it('reverses through flat, realising the old position and opening a new one', () => {
    const open = applyFill(FLAT_POSITION, 'buy', QTY_SCALE, 4_000_000, T0).position;
    const { position, realisedCents } = applyFill(open, 'sell', 3 * QTY_SCALE, 4_100_000, T0 + 60_000);
    expect(realisedCents).toBe(100_000);
    expect(position.qty).toBe(-2 * QTY_SCALE);
    expect(averageEntry(position)).toBe(4_100_000);
    // A reversal is a new position, so its clock restarts.
    expect(position.openedAt).toBe(T0 + 60_000);
  });

  it('closing exactly flat leaves nothing behind', () => {
    const open = applyFill(FLAT_POSITION, 'buy', QTY_SCALE, 4_000_000, T0).position;
    const { position } = applyFill(open, 'sell', QTY_SCALE, 4_000_000, T0);
    expect(position).toEqual(FLAT_POSITION);
    expect(averageEntry(position)).toBe(0);
    expect(unrealisedPnl(position, 9_999_999)).toBe(0);
  });

  it('loses nothing to rounding over many partial reductions', () => {
    // A quantity that does not divide evenly, closed in seven pieces.
    const total = 1_000_003;
    let position = applyFill(FLAT_POSITION, 'buy', total, 4_000_000, T0).position;
    let realised = 0;
    const slice = Math.floor(total / 7);
    for (let i = 0; i < 6; i++) {
      const out = applyFill(position, 'sell', slice, 4_000_000, T0);
      position = out.position;
      realised += out.realisedCents;
    }
    const out = applyFill(position, 'sell', position.qty, 4_000_000, T0);
    realised += out.realisedCents;
    expect(out.position.qty).toBe(0);
    // Closed at the entry price throughout, so the net must be exactly zero.
    expect(realised).toBe(0);
  });

  it('unrealised profit is symmetric between long and short', () => {
    const long = applyFill(FLAT_POSITION, 'buy', QTY_SCALE, 4_000_000, T0).position;
    const short = applyFill(FLAT_POSITION, 'sell', QTY_SCALE, 4_000_000, T0).position;
    expect(unrealisedPnl(long, 4_100_000)).toBe(100_000);
    expect(unrealisedPnl(short, 4_100_000)).toBe(-100_000);
    expect(unrealisedPnl(long, 3_900_000)).toBe(-100_000);
    expect(unrealisedPnl(short, 3_900_000)).toBe(100_000);
  });

  it('notional is absolute, whichever way the position points', () => {
    const short = applyFill(FLAT_POSITION, 'sell', 2 * QTY_SCALE, 4_000_000, T0).position;
    expect(positionNotional(short, 4_000_000)).toBe(8_000_000);
  });
});

describe('fill prices', () => {
  const settings = { ...DEFAULT_SETTINGS };

  it('takes the far side of the spread', () => {
    const q = quote(4_000_000, 200);
    expect(fillPrice('buy', QTY_SCALE, q, { ...settings, slippage: false })).toBe(q.askCents);
    expect(fillPrice('sell', QTY_SCALE, q, { ...settings, slippage: false })).toBe(q.bidCents);
  });

  it('ignores the spread when it is switched off', () => {
    const q = quote(4_000_000, 200);
    const noSpread = { ...settings, spread: false, slippage: false };
    expect(fillPrice('buy', QTY_SCALE, q, noSpread)).toBe(q.lastCents);
    expect(fillPrice('sell', QTY_SCALE, q, noSpread)).toBe(q.lastCents);
  });

  it('always moves the price against the trader', () => {
    const q = quote(4_000_000, 200);
    expect(fillPrice('buy', QTY_SCALE, q, settings)).toBeGreaterThan(q.askCents);
    expect(fillPrice('sell', QTY_SCALE, q, settings)).toBeLessThan(q.bidCents);
  });

  it('gets worse as the order gets bigger', () => {
    const q = quote(4_000_000, 200);
    const small = fillPrice('buy', QTY_SCALE / 10, q, settings);
    const medium = fillPrice('buy', QTY_SCALE, q, settings);
    const large = fillPrice('buy', 50 * QTY_SCALE, q, settings);
    expect(medium).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(medium);
  });

  it('gets worse as volatility rises', () => {
    const calm = fillPrice('buy', QTY_SCALE, quote(4_000_000, 200, 0.5), settings);
    const wild = fillPrice('buy', QTY_SCALE, quote(4_000_000, 200, 4), settings);
    expect(wild).toBeGreaterThan(calm);
  });

  it('never fills at zero or below', () => {
    const q: Quote = { timeMs: T0, lastCents: 3, bidCents: 2, askCents: 4, volFactor: 50 };
    expect(fillPrice('sell', 1_000 * QTY_SCALE, q, settings)).toBeGreaterThan(0);
  });
});

describe('market orders', () => {
  it('fills, charges commission and moves the balance', () => {
    const start = account({ spread: false, slippage: false });
    const result = submitMarketOrder(start, 'buy', QTY_SCALE, quote(4_000_000));
    expect(result.order.status).toBe('filled');
    expect(result.order.fillPriceCents).toBe(4_000_000);
    // 0.055% of $40,000 is $22.00.
    expect(result.order.feeCents).toBe(2_200);
    expect(result.account.balanceCents).toBe(start.balanceCents - 2_200);
    expect(result.account.feesCents).toBe(2_200);
    expect(result.account.position.qty).toBe(QTY_SCALE);
  });

  it('records an execution with the realised amount', () => {
    let acc = account(CLEAN);
    acc = submitMarketOrder(acc, 'buy', QTY_SCALE, quote(4_000_000)).account;
    const out = submitMarketOrder(acc, 'sell', QTY_SCALE, quote(4_100_000));
    expect(out.execution?.realisedCents).toBe(100_000);
    expect(out.account.realisedPnlCents).toBe(100_000);
    expect(out.account.balanceCents).toBe(DEFAULT_SETTINGS.startingBalanceCents + 100_000);
    expect(out.account.executions).toHaveLength(2);
  });

  it('charges commission on both legs of a round trip', () => {
    let acc = account({ spread: false, slippage: false });
    acc = submitMarketOrder(acc, 'buy', QTY_SCALE, quote(4_000_000)).account;
    acc = submitMarketOrder(acc, 'sell', QTY_SCALE, quote(4_000_000)).account;
    // Two fills at $40,000, 0.055% each.
    expect(acc.feesCents).toBe(4_400);
    expect(acc.realisedPnlCents).toBe(0);
    expect(acc.balanceCents).toBe(DEFAULT_SETTINGS.startingBalanceCents - 4_400);
  });

  it('rejects a zero quantity', () => {
    const start = account();
    const out = submitMarketOrder(start, 'buy', 0, quote(4_000_000));
    expect(out.order.status).toBe('rejected');
    expect(out.account).toBe(start);
  });

  it('rejects an order the account cannot margin', () => {
    // $100,000 at 10x can carry $1,000,000 of notional: 25 DAVID at $40,000.
    const start = account({ ...CLEAN, leverage: 10 });
    const ok = submitMarketOrder(start, 'buy', unitsToQty(20), quote(4_000_000));
    expect(ok.order.status).toBe('filled');
    const tooBig = submitMarketOrder(start, 'buy', unitsToQty(40), quote(4_000_000));
    expect(tooBig.order.status).toBe('rejected');
    expect(tooBig.order.reason).toBe('Not enough margin');
    expect(tooBig.account).toBe(start);
  });

  it('always allows an order that reduces the position', () => {
    let acc = account({ ...CLEAN, leverage: 50 });
    acc = submitMarketOrder(acc, 'buy', unitsToQty(100), quote(4_000_000)).account;
    // A big adverse move leaves almost no free margin.
    const stressed = quote(3_920_000);
    const reduce = submitMarketOrder(acc, 'sell', unitsToQty(50), stressed);
    expect(reduce.order.status).toBe('filled');
    expect(reduce.account.position.qty).toBe(unitsToQty(50));
  });

  it('leverage decides how much can be opened', () => {
    const low = submitMarketOrder(account({ ...CLEAN, leverage: 1 }), 'buy', unitsToQty(5), quote(4_000_000));
    expect(low.order.status).toBe('rejected');
    const high = submitMarketOrder(account({ ...CLEAN, leverage: 125 }), 'buy', unitsToQty(5), quote(4_000_000));
    expect(high.order.status).toBe('filled');
  });
});

describe('margin', () => {
  const position = applyFill(FLAT_POSITION, 'buy', unitsToQty(2), 4_000_000, T0).position;

  it('initial margin is notional divided by leverage', () => {
    expect(requiredMargin(position, 4_000_000, { ...DEFAULT_SETTINGS, leverage: 10 })).toBe(800_000);
    expect(requiredMargin(position, 4_000_000, { ...DEFAULT_SETTINGS, leverage: 1 })).toBe(8_000_000);
    expect(requiredMargin(position, 4_000_000, { ...DEFAULT_SETTINGS, leverage: 125 })).toBe(64_000);
  });

  it('maintenance margin is a fraction of notional', () => {
    // 0.5% of $80,000 is $400.
    expect(maintenanceMargin(position, 4_000_000, DEFAULT_SETTINGS)).toBe(40_000);
  });

  it('both are zero when flat', () => {
    expect(requiredMargin(FLAT_POSITION, 4_000_000, DEFAULT_SETTINGS)).toBe(0);
    expect(maintenanceMargin(FLAT_POSITION, 4_000_000, DEFAULT_SETTINGS)).toBe(0);
  });

  it('margin follows the mark price', () => {
    const atEntry = requiredMargin(position, 4_000_000, DEFAULT_SETTINGS);
    const higher = requiredMargin(position, 4_400_000, DEFAULT_SETTINGS);
    expect(higher).toBeGreaterThan(atEntry);
  });
});

describe('liquidation price', () => {
  it('sits below entry for a long, by roughly the leveraged move', () => {
    const settings: AccountSettings = { ...DEFAULT_SETTINGS, leverage: 10 };
    // $4,000 of balance against 1 DAVID at $40,000 is exactly 10x.
    const position = applyFill(FLAT_POSITION, 'buy', QTY_SCALE, 4_000_000, T0).position;
    const price = liquidationPrice(position, 400_000, settings);
    expect(price).not.toBeNull();
    // Down 10% plus the 0.5% maintenance cushion.
    expect(price as number).toBeGreaterThan(3_590_000);
    expect(price as number).toBeLessThan(3_640_000);
  });

  it('sits above entry for a short', () => {
    const settings: AccountSettings = { ...DEFAULT_SETTINGS, leverage: 10 };
    const position = applyFill(FLAT_POSITION, 'sell', QTY_SCALE, 4_000_000, T0).position;
    const price = liquidationPrice(position, 400_000, settings);
    expect(price as number).toBeGreaterThan(4_360_000);
    expect(price as number).toBeLessThan(4_400_000);
  });

  it('is exactly where equity meets maintenance', () => {
    const settings: AccountSettings = { ...DEFAULT_SETTINGS, leverage: 20 };
    const position = applyFill(FLAT_POSITION, 'buy', unitsToQty(3), 4_000_000, T0).position;
    const balance = 900_000;
    const price = liquidationPrice(position, balance, settings) as number;
    const equity = balance + unrealisedPnl(position, price);
    const maintenance = maintenanceMargin(position, price, settings);
    // Within a cent, which is the rounding of the price itself.
    expect(Math.abs(equity - maintenance)).toBeLessThanOrEqual(2);
  });

  it('moves further away as leverage falls', () => {
    const position = applyFill(FLAT_POSITION, 'buy', QTY_SCALE, 4_000_000, T0).position;
    const at5 = liquidationPrice(position, 800_000, { ...DEFAULT_SETTINGS, leverage: 5 }) as number;
    const at25 = liquidationPrice(position, 160_000, { ...DEFAULT_SETTINGS, leverage: 25 }) as number;
    expect(at5).toBeLessThan(at25);
  });

  it('is null when flat', () => {
    expect(liquidationPrice(FLAT_POSITION, 1_000_000, DEFAULT_SETTINGS)).toBeNull();
  });
});

describe('automatic liquidation', () => {
  function leveragedLong(leverage: number, units: number) {
    let acc = account({ ...CLEAN, leverage });
    acc = submitMarketOrder(acc, 'buy', unitsToQty(units), quote(4_000_000)).account;
    return acc;
  }

  it('leaves a healthy position alone', () => {
    const acc = leveragedLong(10, 20);
    const out = checkLiquidation(acc, quote(3_990_000));
    expect(out.execution).toBeNull();
    expect(out.account).toBe(acc);
  });

  it('closes the position once equity falls to maintenance', () => {
    const acc = leveragedLong(25, 60); // $2.4m notional on $100k
    const metrics = accountMetrics(acc, quote(4_000_000));
    const liq = metrics.liquidationCents as number;
    const out = checkLiquidation(acc, quote(liq - 1_000));
    expect(out.execution).not.toBeNull();
    expect(out.execution?.system).toBe(true);
    expect(out.account.position.qty).toBe(0);
  });

  it('marks the forced order as a system order in the history', () => {
    const acc = leveragedLong(50, 100);
    const liq = accountMetrics(acc, quote(4_000_000)).liquidationCents as number;
    const out = checkLiquidation(acc, quote(liq - 5_000));
    const last = out.account.orders[out.account.orders.length - 1];
    expect(last?.system).toBe(true);
    expect(last?.side).toBe('sell');
  });

  it('liquidates a short when price rises far enough', () => {
    let acc = account({ ...CLEAN, leverage: 25 });
    acc = submitMarketOrder(acc, 'sell', unitsToQty(60), quote(4_000_000)).account;
    const liq = accountMetrics(acc, quote(4_000_000)).liquidationCents as number;
    const out = checkLiquidation(acc, quote(liq + 1_000));
    expect(out.account.position.qty).toBe(0);
    expect(out.execution?.side).toBe('buy');
  });

  it('does nothing when flat', () => {
    const acc = account();
    expect(checkLiquidation(acc, quote(1)).execution).toBeNull();
  });
});

describe('account metrics', () => {
  it('reports a flat account cleanly', () => {
    const m = accountMetrics(account(), quote(4_000_000));
    expect(m.equityCents).toBe(DEFAULT_SETTINGS.startingBalanceCents);
    expect(m.positionMarginCents).toBe(0);
    expect(m.availableCents).toBe(DEFAULT_SETTINGS.startingBalanceCents);
    expect(m.liquidationCents).toBeNull();
    expect(m.marginBuffer).toBe(1);
  });

  it('equity is balance plus unrealised, and available nets off margin', () => {
    let acc = account({ ...CLEAN, leverage: 10 });
    acc = submitMarketOrder(acc, 'buy', unitsToQty(2), quote(4_000_000)).account;
    const m = accountMetrics(acc, quote(4_100_000));
    expect(m.unrealisedPnlCents).toBe(200_000);
    expect(m.equityCents).toBe(DEFAULT_SETTINGS.startingBalanceCents + 200_000);
    expect(m.positionMarginCents).toBe(820_000); // $82,000 notional / 10
    expect(m.availableCents).toBe(m.equityCents - m.positionMarginCents);
  });

  it('margin buffer shrinks as the position moves against you', () => {
    let acc = account({ ...CLEAN, leverage: 50 });
    acc = submitMarketOrder(acc, 'buy', unitsToQty(100), quote(4_000_000)).account;
    const healthy = accountMetrics(acc, quote(4_000_000)).marginBuffer;
    const stressed = accountMetrics(acc, quote(3_950_000)).marginBuffer;
    expect(stressed).toBeLessThan(healthy);
    expect(stressed).toBeGreaterThanOrEqual(0);
  });

  it('reports the tick value of the open position', () => {
    let acc = account(CLEAN);
    acc = submitMarketOrder(acc, 'buy', unitsToQty(2.5), quote(4_000_000)).account;
    expect(accountMetrics(acc, quote(4_000_000), 1).tickValueCents).toBe(3);
  });
});

describe('reset', () => {
  it('returns the balance and clears all history', () => {
    let acc = account(CLEAN);
    acc = submitMarketOrder(acc, 'buy', QTY_SCALE, quote(4_000_000)).account;
    acc = submitMarketOrder(acc, 'sell', QTY_SCALE, quote(3_900_000)).account;
    expect(acc.balanceCents).toBeLessThan(DEFAULT_SETTINGS.startingBalanceCents);
    const fresh = resetAccount(acc);
    expect(fresh.balanceCents).toBe(DEFAULT_SETTINGS.startingBalanceCents);
    expect(fresh.position).toEqual(FLAT_POSITION);
    expect(fresh.orders).toHaveLength(0);
    expect(fresh.executions).toHaveLength(0);
    expect(fresh.realisedPnlCents).toBe(0);
    expect(fresh.feesCents).toBe(0);
    // Settings and identity survive a reset.
    expect(fresh.settings).toEqual(acc.settings);
    expect(fresh.id).toBe(acc.id);
  });
});

describe('a full round trip holds its books', () => {
  it('balance equals starting balance plus realised minus fees', () => {
    let acc = account({ leverage: 20 });
    const prices = [4_000_000, 4_050_000, 3_980_000, 4_120_000, 4_060_000];
    const sides = ['buy', 'sell', 'buy', 'sell', 'sell'] as const;
    const sizes = [2, 1, 3, 2, 2];
    sides.forEach((side, i) => {
      acc = submitMarketOrder(acc, side, unitsToQty(sizes[i] as number), quote(prices[i] as number)).account;
    });
    expect(acc.balanceCents).toBe(
      DEFAULT_SETTINGS.startingBalanceCents + acc.realisedPnlCents - acc.feesCents,
    );
    // Every fill is recorded exactly once.
    expect(acc.executions).toHaveLength(5);
    expect(acc.orders.every((o) => o.status === 'filled')).toBe(true);
    // And the realised total matches the sum of the executions.
    const summed = acc.executions.reduce((sum, x) => sum + x.realisedCents, 0);
    expect(summed).toBe(acc.realisedPnlCents);
  });
});

describe('trading store', () => {
  /** The store reads localStorage at import; in Node that falls back cleanly. */
  it('starts with one account at the default balance', async () => {
    const { useTrading } = await import('@/state/tradingStore');
    const account = useTrading.getState().active();
    expect(account.balanceCents).toBe(DEFAULT_SETTINGS.startingBalanceCents);
    expect(account.position.qty).toBe(0);
  });

  it('close flattens the position, reverse flips it', async () => {
    const { useTrading } = await import('@/state/tradingStore');
    const store = useTrading.getState();
    store.updateSettings({ ...CLEAN, leverage: 10 });
    store.submitMarket('buy', unitsToQty(1), quote(4_000_000));
    expect(useTrading.getState().active().position.qty).toBe(unitsToQty(1));

    useTrading.getState().reversePosition(quote(4_000_000));
    expect(useTrading.getState().active().position.qty).toBe(-unitsToQty(1));

    useTrading.getState().closePosition(quote(4_000_000));
    expect(useTrading.getState().active().position.qty).toBe(0);
  });

  it('closing or reversing while flat does nothing', async () => {
    const { useTrading } = await import('@/state/tradingStore');
    useTrading.getState().reset();
    const before = useTrading.getState().active();
    useTrading.getState().closePosition(quote(4_000_000));
    useTrading.getState().reversePosition(quote(4_000_000));
    expect(useTrading.getState().active().orders).toHaveLength(before.orders.length);
  });

  it('clamps leverage into the allowed range', async () => {
    const { useTrading } = await import('@/state/tradingStore');
    useTrading.getState().updateSettings({ leverage: 1_000 });
    expect(useTrading.getState().active().settings.leverage).toBe(125);
    useTrading.getState().updateSettings({ leverage: 0 });
    expect(useTrading.getState().active().settings.leverage).toBe(1);
  });

  it('changing the starting balance also resets cash on an untouched account', async () => {
    const { useTrading } = await import('@/state/tradingStore');
    useTrading.getState().reset();
    useTrading.getState().updateSettings({ startingBalanceCents: 2_500_000 });
    expect(useTrading.getState().active().balanceCents).toBe(2_500_000);
  });

  it('leaves cash alone when the account has already traded', async () => {
    const { useTrading } = await import('@/state/tradingStore');
    useTrading.getState().reset();
    useTrading.getState().updateSettings({ ...CLEAN, leverage: 10 });
    useTrading.getState().submitMarket('buy', unitsToQty(0.1), quote(4_000_000));
    const traded = useTrading.getState().active().balanceCents;
    useTrading.getState().updateSettings({ startingBalanceCents: 9_999_900 });
    expect(useTrading.getState().active().balanceCents).toBe(traded);
  });

  it('marks to market and liquidates when equity runs out', async () => {
    const { useTrading } = await import('@/state/tradingStore');
    useTrading.getState().reset();
    useTrading.getState().updateSettings({ ...CLEAN, leverage: 50, startingBalanceCents: 10_000_000 });
    useTrading.getState().reset();
    useTrading.getState().submitMarket('buy', unitsToQty(100), quote(4_000_000));
    expect(useTrading.getState().active().position.qty).toBe(unitsToQty(100));

    // Well past the liquidation price for a 50x long.
    useTrading.getState().markToMarket(quote(3_800_000));
    const account = useTrading.getState().active();
    expect(account.position.qty).toBe(0);
    const last = account.orders[account.orders.length - 1];
    expect(last?.system).toBe(true);
  });

  it('a reset restores the balance and clears history', async () => {
    const { useTrading } = await import('@/state/tradingStore');
    useTrading.getState().reset();
    const account = useTrading.getState().active();
    expect(account.orders).toHaveLength(0);
    expect(account.balanceCents).toBe(account.settings.startingBalanceCents);
  });
});

describe('the largest affordable order', () => {
  /**
   * The order panel's "%" control divides this number up, so 100% has to be a
   * size that is actually accepted — and 100% plus a hair has to not be.
   */
  it('is affordable, and one step more is not', () => {
    const acc = account({ leverage: 20 });
    const q = quote(4_000_000);
    const max = maxAffordableQty(acc, 'buy', q);
    expect(max).toBeGreaterThan(0);
    expect(previewMarketOrder(acc, 'buy', max, q).affordable).toBe(true);
    expect(previewMarketOrder(acc, 'buy', max + 1, q).affordable).toBe(false);
  });

  it('holds at every leverage', () => {
    const q = quote(4_000_000);
    for (const leverage of [1, 2, 5, 10, 25, 50, 125]) {
      const acc = account({ leverage });
      const max = maxAffordableQty(acc, 'buy', q);
      expect(previewMarketOrder(acc, 'buy', max, q).affordable).toBe(true);
      expect(previewMarketOrder(acc, 'buy', max + 1, q).affordable).toBe(false);
    }
  });

  it('holds for both sides', () => {
    const acc = account({ leverage: 10 });
    const q = quote(4_000_000);
    for (const side of ['buy', 'sell'] as const) {
      const max = maxAffordableQty(acc, side, q);
      expect(previewMarketOrder(acc, side, max, q).affordable).toBe(true);
      expect(previewMarketOrder(acc, side, max + 1, q).affordable).toBe(false);
    }
  });

  it('grows when the commission is cut', () => {
    const q = quote(4_000_000);
    const dear = maxAffordableQty(account({ leverage: 10, takerFeePpm: 5000 }), 'buy', q);
    const cheap = maxAffordableQty(account({ leverage: 10, takerFeePpm: 0 }), 'buy', q);
    expect(cheap).toBeGreaterThan(dear);
  });

  it('leaves no available margin once the whole of it is used', () => {
    const acc = account({ leverage: 20 });
    const q = quote(4_000_000);
    const filled = submitMarketOrder(acc, 'buy', maxAffordableQty(acc, 'buy', q), q).account;
    const after = accountMetrics(filled, q);
    expect(after.availableCents).toBeGreaterThanOrEqual(0);
    // Within a cent of nothing left: the whole account is committed.
    expect(after.availableCents).toBeLessThan(100);
  });

  it('is zero for an account with no equity left', () => {
    const broke = { ...account(), balanceCents: 0 };
    expect(maxAffordableQty(broke, 'buy', quote(4_000_000))).toBe(0);
  });

  it('allows a reduce-only sized order against an open position', () => {
    const acc = account({ leverage: 10 });
    const q = quote(4_000_000);
    const opened = submitMarketOrder(acc, 'buy', unitsToQty(1), q).account;
    // Selling is partly a reduction, so more is affordable than from flat.
    expect(maxAffordableQty(opened, 'sell', q)).toBeGreaterThan(maxAffordableQty(acc, 'sell', q));
  });
});

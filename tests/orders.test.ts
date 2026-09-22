import { beforeEach, describe, expect, it } from 'vitest';
import { createAccount, resetIdSequence, submitMarketOrder } from '@/trading/engine';
import {
  attachBrackets,
  cancelAllOrders,
  cancelOrder,
  defaultBracketPrices,
  modifyOrder,
  previewOrder,
  processOrders,
  resetOrderIdSequence,
  submitOrder,
} from '@/trading/orders';
import { unitsToQty } from '@/trading/money';
import {
  DEFAULT_SETTINGS,
  type Account,
  type AccountSettings,
  type Order,
  type PriceRange,
  type Quote,
} from '@/trading/types';

const T0 = Date.UTC(2026, 0, 2, 9, 0, 0);

function quote(last: number, spread = 200): Quote {
  return {
    timeMs: T0,
    lastCents: last,
    bidCents: last - spread / 2,
    askCents: last + spread / 2,
    volFactor: 1,
  };
}

/** The range the price covered since the previous tick. */
function range(a: number, b = a): PriceRange {
  return { lowCents: Math.min(a, b), highCents: Math.max(a, b) };
}

const CLEAN: Partial<AccountSettings> = {
  spread: false,
  slippage: false,
  takerFeePpm: 0,
  makerFeePpm: 0,
};

function account(overrides: Partial<AccountSettings> = {}): Account {
  return createAccount('a1', 'Test', { ...DEFAULT_SETTINGS, ...overrides }, T0);
}

function working(acc: Account): Order[] {
  return acc.orders.filter((o) => o.status === 'working');
}

beforeEach(() => {
  resetIdSequence();
  resetOrderIdSequence();
});

describe('placing resting orders', () => {
  it('a limit order rests rather than filling', () => {
    const out = submitOrder(
      account(CLEAN),
      { side: 'buy', type: 'limit', qty: unitsToQty(1), limitCents: 3_900_000 },
      quote(4_000_000),
    );
    expect(out.order.status).toBe('working');
    expect(out.executions).toHaveLength(0);
    expect(out.account.position.qty).toBe(0);
    expect(working(out.account)).toHaveLength(1);
  });

  it('a market order still fills immediately', () => {
    const out = submitOrder(
      account(CLEAN),
      { side: 'buy', type: 'market', qty: unitsToQty(1) },
      quote(4_000_000),
    );
    expect(out.order.status).toBe('filled');
    expect(out.account.position.qty).toBe(unitsToQty(1));
  });

  it('requires a price for the type asked for', () => {
    const noLimit = submitOrder(
      account(),
      { side: 'buy', type: 'limit', qty: unitsToQty(1) },
      quote(4_000_000),
    );
    expect(noLimit.rejected).toBe('A limit price is required');

    const noStop = submitOrder(
      account(),
      { side: 'buy', type: 'stop', qty: unitsToQty(1) },
      quote(4_000_000),
    );
    expect(noStop.rejected).toBe('A stop price is required');

    const halfStopLimit = submitOrder(
      account(),
      { side: 'buy', type: 'stopLimit', qty: unitsToQty(1), stopCents: 4_100_000 },
      quote(4_000_000),
    );
    expect(halfStopLimit.rejected).toBe('A limit price is required');
  });

  it('rejects a resting order the account could not margin', () => {
    const out = submitOrder(
      account({ ...CLEAN, leverage: 2 }),
      { side: 'buy', type: 'limit', qty: unitsToQty(20), limitCents: 4_000_000 },
      quote(4_000_000),
    );
    expect(out.rejected).toBe('Not enough margin');
    expect(working(out.account)).toHaveLength(0);
  });

  it('never rejects a reduce-only order for margin', () => {
    let acc = account({ ...CLEAN, leverage: 50 });
    acc = submitMarketOrder(acc, 'buy', unitsToQty(100), quote(4_000_000)).account;
    const out = submitOrder(
      acc,
      { side: 'sell', type: 'limit', qty: unitsToQty(100), limitCents: 4_100_000, reduceOnly: true },
      quote(4_000_000),
    );
    expect(out.order.status).toBe('working');
  });

  it('rejects a zero quantity', () => {
    const out = submitOrder(account(), { side: 'buy', type: 'limit', qty: 0, limitCents: 1 }, quote(4_000_000));
    expect(out.rejected).toBe('Quantity must be greater than zero');
  });
});

describe('limit orders', () => {
  function restingBuy(limit: number) {
    return submitOrder(
      account(CLEAN),
      { side: 'buy', type: 'limit', qty: unitsToQty(1), limitCents: limit },
      quote(4_000_000),
    ).account;
  }

  it('does not fill while the price stays away', () => {
    const acc = restingBuy(3_900_000);
    const out = processOrders(acc, quote(3_950_000), range(3_940_000, 3_960_000));
    expect(out.executions).toHaveLength(0);
    expect(working(out.account)).toHaveLength(1);
  });

  it('fills when the price trades through it', () => {
    const acc = restingBuy(3_900_000);
    const out = processOrders(acc, quote(3_890_000), range(3_885_000, 3_950_000));
    expect(out.executions).toHaveLength(1);
    expect(out.account.position.qty).toBe(unitsToQty(1));
    expect(out.executions[0]?.priceCents).toBe(3_900_000);
  });

  it('fills even if no tick landed exactly on the price', () => {
    // The market gapped from above to below the limit between two ticks.
    const acc = restingBuy(3_900_000);
    const out = processOrders(acc, quote(3_800_000), range(3_800_000, 3_990_000));
    expect(out.executions).toHaveLength(1);
  });

  it('a limit placed through the market fills immediately, as a taker', () => {
    // A buy limit above the ask crosses the spread: it takes liquidity now.
    const q = quote(4_000_000, 200);
    const out = submitOrder(
      account(CLEAN),
      { side: 'buy', type: 'limit', qty: unitsToQty(1), limitCents: 4_200_000 },
      q,
    );
    expect(out.order.status).toBe('filled');
    expect(out.executions).toHaveLength(1);
    // The market price, not the generous limit the user was willing to pay.
    expect(out.executions[0]?.priceCents).toBe(q.lastCents);
    expect(out.account.position.qty).toBe(unitsToQty(1));
  });

  it('never pays worse than its limit, even with slippage', () => {
    const q = quote(4_000_000, 2_000);
    const out = submitOrder(
      account({ slippage: true, takerFeePpm: 0, makerFeePpm: 0 }),
      { side: 'buy', type: 'limit', qty: unitsToQty(5), limitCents: q.askCents + 10 },
      q,
    );
    expect(out.executions[0]?.priceCents).toBeLessThanOrEqual(q.askCents + 10);
  });

  it('a resting limit gets its own price, not a better one', () => {
    // The market gapped well below the limit; the fill is still at the limit.
    const acc = restingBuy(3_900_000);
    const out = processOrders(acc, quote(3_800_000), range(3_795_000, 3_990_000));
    expect(out.executions[0]?.priceCents).toBe(3_900_000);
  });

  it('a sell limit fills when the price rises through it', () => {
    let acc = account(CLEAN);
    acc = submitOrder(
      acc,
      { side: 'sell', type: 'limit', qty: unitsToQty(1), limitCents: 4_100_000 },
      quote(4_000_000),
    ).account;
    const still = processOrders(acc, quote(4_050_000), range(4_040_000, 4_060_000));
    expect(still.executions).toHaveLength(0);
    const out = processOrders(acc, quote(4_120_000), range(4_060_000, 4_130_000));
    expect(out.executions).toHaveLength(1);
    expect(out.account.position.qty).toBe(-unitsToQty(1));
  });

  it('pays the maker commission, not the taker one', () => {
    let acc = account({ makerFeePpm: 200, takerFeePpm: 550, spread: false, slippage: false });
    acc = submitOrder(
      acc,
      { side: 'buy', type: 'limit', qty: unitsToQty(1), limitCents: 4_000_000 },
      quote(4_100_000),
    ).account;
    const out = processOrders(acc, quote(3_990_000), range(3_990_000, 4_100_000));
    // 0.02% of $40,000 is $8.00.
    expect(out.executions[0]?.feeCents).toBe(800);
  });
});

describe('stop orders', () => {
  it('triggers on the last price and fills at market', () => {
    let acc = account({ slippage: false });
    acc = submitOrder(
      acc,
      { side: 'buy', type: 'stop', qty: unitsToQty(1), stopCents: 4_100_000 },
      quote(4_000_000),
    ).account;
    const still = processOrders(acc, quote(4_050_000), range(4_040_000, 4_060_000));
    expect(still.executions).toHaveLength(0);

    const q = quote(4_110_000, 200);
    const out = processOrders(acc, q, range(4_060_000, 4_115_000));
    expect(out.executions).toHaveLength(1);
    // A buy stop pays the ask, because it becomes a market order.
    expect(out.executions[0]?.priceCents).toBe(q.askCents);
  });

  it('a sell stop triggers when the price falls through it', () => {
    let acc = account({ slippage: false });
    acc = submitOrder(
      acc,
      { side: 'sell', type: 'stop', qty: unitsToQty(1), stopCents: 3_900_000 },
      quote(4_000_000),
    ).account;
    const q = quote(3_890_000, 200);
    const out = processOrders(acc, q, range(3_885_000, 3_990_000));
    expect(out.executions[0]?.priceCents).toBe(q.bidCents);
    expect(out.account.position.qty).toBe(-unitsToQty(1));
  });

  it('is subject to slippage, as any market order is', () => {
    let acc = account({ slippage: true });
    acc = submitOrder(
      acc,
      { side: 'sell', type: 'stop', qty: unitsToQty(5), stopCents: 3_900_000 },
      quote(4_000_000),
    ).account;
    const q = quote(3_890_000, 200);
    const out = processOrders(acc, q, range(3_880_000, 3_990_000));
    expect(out.executions[0]?.priceCents).toBeLessThan(q.bidCents);
  });

  it('pays the taker commission', () => {
    let acc = account({ makerFeePpm: 200, takerFeePpm: 550, spread: false, slippage: false });
    acc = submitOrder(
      acc,
      { side: 'buy', type: 'stop', qty: unitsToQty(1), stopCents: 4_000_000 },
      quote(3_900_000),
    ).account;
    const out = processOrders(acc, quote(4_000_000), range(3_900_000, 4_010_000));
    expect(out.executions[0]?.feeCents).toBe(2_200);
  });
});

describe('stop-limit orders', () => {
  function restingStopLimit(stop: number, limit: number) {
    return submitOrder(
      account(CLEAN),
      { side: 'buy', type: 'stopLimit', qty: unitsToQty(1), stopCents: stop, limitCents: limit },
      quote(4_000_000),
    ).account;
  }

  it('does nothing until the trigger is reached', () => {
    const acc = restingStopLimit(4_100_000, 4_120_000);
    const out = processOrders(acc, quote(4_050_000), range(4_040_000, 4_060_000));
    expect(out.executions).toHaveLength(0);
    expect(working(out.account)[0]?.triggered).toBeUndefined();
  });

  it('becomes a resting limit once triggered', () => {
    // Trigger at 4,100,000 but the limit is below, so it waits.
    const acc = restingStopLimit(4_100_000, 4_050_000);
    const first = processOrders(acc, quote(4_110_000), range(4_060_000, 4_115_000));
    expect(first.executions).toHaveLength(0);
    expect(working(first.account)[0]?.triggered).toBe(true);

    const second = processOrders(first.account, quote(4_040_000), range(4_030_000, 4_110_000));
    expect(second.executions).toHaveLength(1);
    expect(second.executions[0]?.priceCents).toBe(4_050_000);
  });

  it('stays triggered even if the price moves back past the stop', () => {
    const acc = restingStopLimit(4_100_000, 4_050_000);
    const triggered = processOrders(acc, quote(4_110_000), range(4_100_000, 4_115_000));
    const backDown = processOrders(triggered.account, quote(4_060_000), range(4_055_000, 4_110_000));
    expect(working(backDown.account)[0]?.triggered).toBe(true);
  });

  it('fills on the same tick when both conditions are met', () => {
    const acc = restingStopLimit(4_100_000, 4_120_000);
    const out = processOrders(acc, quote(4_130_000), range(4_090_000, 4_140_000));
    expect(out.executions).toHaveLength(1);
  });
});

describe('brackets and OCO', () => {
  function longWithBrackets() {
    return submitOrder(
      account(CLEAN),
      {
        side: 'buy',
        type: 'market',
        qty: unitsToQty(1),
        takeProfitCents: 4_200_000,
        stopLossCents: 3_900_000,
      },
      quote(4_000_000),
    ).account;
  }

  it('attaches a take-profit and a stop-loss once the entry fills', () => {
    const acc = longWithBrackets();
    const exits = working(acc);
    expect(exits).toHaveLength(2);
    expect(exits.map((o) => o.tag).sort()).toEqual(['sl', 'tp']);
    // Both sell, because the position is long, and both reduce-only.
    expect(exits.every((o) => o.side === 'sell' && o.reduceOnly)).toBe(true);
    expect(new Set(exits.map((o) => o.ocoGroup)).size).toBe(1);
  });

  it('the take-profit filling cancels the stop-loss', () => {
    const acc = longWithBrackets();
    const out = processOrders(acc, quote(4_210_000), range(4_150_000, 4_215_000));
    expect(out.account.position.qty).toBe(0);
    expect(working(out.account)).toHaveLength(0);
    const sl = out.account.orders.find((o) => o.tag === 'sl');
    expect(sl?.status).toBe('cancelled');
    const tp = out.account.orders.find((o) => o.tag === 'tp');
    expect(tp?.status).toBe('filled');
  });

  it('the stop-loss filling cancels the take-profit', () => {
    const acc = longWithBrackets();
    const out = processOrders(acc, quote(3_890_000), range(3_885_000, 3_990_000));
    expect(out.account.position.qty).toBe(0);
    expect(out.account.orders.find((o) => o.tag === 'tp')?.status).toBe('cancelled');
    expect(out.account.orders.find((o) => o.tag === 'sl')?.status).toBe('filled');
  });

  it('only one side can fill, even when a single move crosses both', () => {
    const acc = longWithBrackets();
    // A violent candle that sweeps from below the stop to above the target.
    const out = processOrders(acc, quote(4_250_000), range(3_800_000, 4_300_000));
    expect(out.executions).toHaveLength(1);
    expect(out.account.position.qty).toBe(0);
  });

  it('brackets on a short exit by buying', () => {
    const acc = submitOrder(
      account(CLEAN),
      {
        side: 'sell',
        type: 'market',
        qty: unitsToQty(1),
        takeProfitCents: 3_800_000,
        stopLossCents: 4_100_000,
      },
      quote(4_000_000),
    ).account;
    expect(working(acc).every((o) => o.side === 'buy')).toBe(true);
    const out = processOrders(acc, quote(3_790_000), range(3_780_000, 3_900_000));
    expect(out.account.position.qty).toBe(0);
  });

  it('a limit entry attaches its brackets only when it fills', () => {
    const acc = submitOrder(
      account(CLEAN),
      {
        side: 'buy',
        type: 'limit',
        qty: unitsToQty(1),
        limitCents: 3_950_000,
        takeProfitCents: 4_200_000,
        stopLossCents: 3_900_000,
      },
      quote(4_000_000),
    ).account;
    expect(working(acc)).toHaveLength(1);
    const out = processOrders(acc, quote(3_940_000), range(3_930_000, 4_000_000));
    expect(out.account.position.qty).toBe(unitsToQty(1));
    expect(working(out.account)).toHaveLength(2);
  });

  it('setting a new bracket replaces the old one', () => {
    let acc = longWithBrackets();
    acc = attachBrackets(acc, { takeProfitCents: 4_500_000, stopLossCents: 3_800_000 }, T0);
    const exits = working(acc);
    expect(exits).toHaveLength(2);
    expect(exits.find((o) => o.tag === 'tp')?.limitCents).toBe(4_500_000);
  });

  it('closing the position by hand cancels the exits', () => {
    let acc = longWithBrackets();
    acc = submitMarketOrder(acc, 'sell', unitsToQty(1), quote(4_050_000)).account;
    const out = processOrders(acc, quote(4_050_000), range(4_045_000, 4_055_000));
    expect(working(out.account)).toHaveLength(0);
    expect(out.cancelled).toHaveLength(2);
  });

  it('a reduce-only exit cannot flip the position', () => {
    // The position has shrunk since the bracket was placed.
    let acc = longWithBrackets();
    acc = submitMarketOrder(acc, 'sell', unitsToQty(0.6), quote(4_050_000)).account;
    const out = processOrders(acc, quote(4_210_000), range(4_150_000, 4_215_000));
    expect(out.account.position.qty).toBe(0);
    // Only the remaining 0.4 was sold, not the original 1.0.
    expect(out.executions[0]?.qty).toBe(unitsToQty(0.4));
  });

  it('suggests a target and a stop either side of the entry', () => {
    const long = defaultBracketPrices(4_000_000, 1);
    expect(long.takeProfitCents).toBeGreaterThan(4_000_000);
    expect(long.stopLossCents).toBeLessThan(4_000_000);
    const short = defaultBracketPrices(4_000_000, -1);
    expect(short.takeProfitCents).toBeLessThan(4_000_000);
    expect(short.stopLossCents).toBeGreaterThan(4_000_000);
  });
});

describe('managing working orders', () => {
  function withLimit() {
    return submitOrder(
      account(CLEAN),
      { side: 'buy', type: 'limit', qty: unitsToQty(1), limitCents: 3_900_000 },
      quote(4_000_000),
    );
  }

  it('cancels one order', () => {
    const { account: acc, order } = withLimit();
    const next = cancelOrder(acc, order.id);
    expect(working(next)).toHaveLength(0);
    expect(next.orders[0]?.status).toBe('cancelled');
  });

  it('cancelling twice is harmless', () => {
    const { account: acc, order } = withLimit();
    const once = cancelOrder(acc, order.id);
    const twice = cancelOrder(once, order.id);
    expect(twice.orders[0]?.status).toBe('cancelled');
  });

  it('cancels everything at once', () => {
    let acc = withLimit().account;
    acc = submitOrder(
      acc,
      { side: 'buy', type: 'stop', qty: unitsToQty(1), stopCents: 4_200_000 },
      quote(4_000_000),
    ).account;
    expect(working(acc)).toHaveLength(2);
    expect(working(cancelAllOrders(acc))).toHaveLength(0);
  });

  it('moves a working order to a new price', () => {
    const { account: acc, order } = withLimit();
    const moved = modifyOrder(acc, order.id, { limitCents: 3_800_000 });
    expect(working(moved)[0]?.limitCents).toBe(3_800_000);
  });

  it('ignores an impossible price and leaves a filled order alone', () => {
    const { account: acc, order } = withLimit();
    expect(modifyOrder(acc, order.id, { limitCents: -5 }).orders[0]?.limitCents).toBe(3_900_000);
    const filled = processOrders(acc, quote(3_890_000), range(3_880_000, 3_990_000)).account;
    const after = modifyOrder(filled, order.id, { limitCents: 1_000_000 });
    expect(after.orders[0]?.limitCents).toBe(3_900_000);
  });

  it('a moved order fills at its new price', () => {
    const { account: acc, order } = withLimit();
    const moved = modifyOrder(acc, order.id, { limitCents: 3_800_000 });
    const notYet = processOrders(moved, quote(3_850_000), range(3_840_000, 3_950_000));
    expect(notYet.executions).toHaveLength(0);
    const out = processOrders(moved, quote(3_790_000), range(3_780_000, 3_900_000));
    expect(out.executions[0]?.priceCents).toBe(3_800_000);
  });
});

describe('order books stay consistent', () => {
  it('balance still equals starting balance plus realised minus fees', () => {
    let acc = account({ leverage: 20 });
    acc = submitOrder(
      acc,
      {
        side: 'buy',
        type: 'market',
        qty: unitsToQty(2),
        takeProfitCents: 4_150_000,
        stopLossCents: 3_950_000,
      },
      quote(4_000_000),
    ).account;
    const out = processOrders(acc, quote(4_160_000), range(4_100_000, 4_170_000));
    const final = out.account;
    expect(final.balanceCents).toBe(
      DEFAULT_SETTINGS.startingBalanceCents + final.realisedPnlCents - final.feesCents,
    );
    const summed = final.executions.reduce((sum, x) => sum + x.realisedCents, 0);
    expect(summed).toBe(final.realisedPnlCents);
  });

  it('processing a tick with nothing working changes nothing', () => {
    const acc = account();
    const out = processOrders(acc, quote(4_000_000), range(3_990_000, 4_010_000));
    expect(out.account).toBe(acc);
    expect(out.executions).toHaveLength(0);
  });
});

describe('the order preview matches what submitting actually does', () => {
  /**
   * The order panel decides whether to enable its submit button from
   * `previewOrder`. If that ever disagrees with `submitOrder`, the panel offers
   * an order that is then rejected — which is what this suite exists to stop.
   */
  const agree = (acc: Account, request: Parameters<typeof previewOrder>[1], q: Quote): void => {
    const preview = previewOrder(acc, request, q);
    const result = submitOrder(acc, request, q);
    expect(preview.affordable).toBe(result.rejected === undefined);
    if (!preview.affordable) expect(result.rejected).toBe(preview.reason);
  };

  it('agrees on a market order the account can easily cover', () => {
    agree(account(), { side: 'buy', type: 'market', qty: unitsToQty(0.1) }, quote(5_000_000));
  });

  it('agrees on a market order that is far too big', () => {
    agree(account(), { side: 'buy', type: 'market', qty: unitsToQty(500) }, quote(5_000_000));
  });

  it('agrees right at the edge, where the commission decides it', () => {
    // A $100,000 balance at 10x covers $1,000,000 of notional on margin alone,
    // which at $10,000 a coin is 100 units — but the taker fee comes out of the
    // same money, so the largest order that actually fits is smaller than that.
    const acc = account({ leverage: 10, takerFeePpm: 5500, spread: false, slippage: false });
    const q = quote(1_000_000, 0);
    const marginOnly = unitsToQty(100);
    agree(acc, { side: 'buy', type: 'market', qty: marginOnly }, q);
    expect(previewOrder(acc, { side: 'buy', type: 'market', qty: marginOnly }, q).affordable).toBe(
      false,
    );

    // Back it off by more than the commission and both accept it.
    const fits = unitsToQty(94);
    agree(acc, { side: 'buy', type: 'market', qty: fits }, q);
    expect(previewOrder(acc, { side: 'buy', type: 'market', qty: fits }, q).affordable).toBe(true);
  });

  it('agrees on a resting limit, whose commission is not held against it', () => {
    const acc = account({ leverage: 10 });
    const q = quote(1_000_000);
    const request = {
      side: 'buy' as const,
      type: 'limit' as const,
      qty: unitsToQty(5),
      limitCents: 900_000,
    };
    agree(acc, request, q);
    const preview = previewOrder(acc, request, q);
    expect(preview.immediate).toBe(false);
    expect(preview.feeCents).toBe(
      Math.round((900_000 * 5 * DEFAULT_SETTINGS.makerFeePpm) / 1_000_000),
    );
  });

  it('charges the taker rate on a limit that crosses the spread', () => {
    const acc = account({ leverage: 10 });
    const q = quote(1_000_000);
    const preview = previewOrder(
      acc,
      { side: 'buy', type: 'limit', qty: unitsToQty(1), limitCents: q.askCents + 1000 },
      q,
    );
    expect(preview.immediate).toBe(true);
  });

  it('agrees on an oversized stop order', () => {
    agree(
      account({ leverage: 5 }),
      { side: 'sell', type: 'stop', qty: unitsToQty(200), stopCents: 4_900_000 },
      quote(5_000_000),
    );
  });

  it('lets a reduce-only exit through even when margin is exhausted', () => {
    const acc = account({ leverage: 100 });
    const q = quote(1_000_000);
    const opened = submitOrder(acc, { side: 'buy', type: 'market', qty: unitsToQty(900) }, q)
      .account;
    const request = {
      side: 'sell' as const,
      type: 'limit' as const,
      qty: unitsToQty(900),
      limitCents: 1_100_000,
      reduceOnly: true,
    };
    agree(opened, request, q);
    expect(previewOrder(opened, request, q).affordable).toBe(true);
  });

  it('rejects a zero quantity from both sides, with the same reason', () => {
    agree(account(), { side: 'buy', type: 'market', qty: 0 }, quote(5_000_000));
    expect(previewOrder(account(), { side: 'buy', type: 'market', qty: 0 }, quote(5_000_000)).reason)
      .toBe('Quantity must be greater than zero');
  });

  it('never disagrees across a sweep of sizes around the limit', () => {
    // The sweep runs straight through the affordable/not-affordable boundary,
    // which at 20x with a 20bp taker fee sits a little under 97 units.
    const acc = account({ leverage: 20, takerFeePpm: 2000 });
    const q = quote(2_000_000);
    for (let units = 88; units <= 108; units += 0.25) {
      agree(acc, { side: 'buy', type: 'market', qty: unitsToQty(units) }, q);
    }
  });
});

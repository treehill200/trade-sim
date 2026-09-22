import { beforeEach, describe, expect, it } from 'vitest';
import { createAccount, resetIdSequence, submitMarketOrder } from '@/trading/engine';
import { buildTrips, equityCurve, tradeStats, tripUnits } from '@/trading/journal';
import { unitsToQty } from '@/trading/money';
import { DEFAULT_SETTINGS, type Account, type Execution, type Quote } from '@/trading/types';

const T0 = Date.UTC(2026, 1, 1, 10, 0, 0);
const MINUTE = 60_000;

function quote(last: number, at = T0): Quote {
  return { timeMs: at, lastCents: last, bidCents: last, askCents: last, volFactor: 1 };
}

/** No spread, no slippage, no fees, so the arithmetic is the arithmetic. */
function account(): Account {
  return createAccount(
    'a1',
    'Test',
    { ...DEFAULT_SETTINGS, spread: false, slippage: false, takerFeePpm: 0, makerFeePpm: 0 },
    T0,
  );
}

/** Run a sequence of market fills and return the executions they produced. */
function run(steps: { side: 'buy' | 'sell'; units: number; price: number; minute: number }[]): Execution[] {
  let acc = account();
  for (const step of steps) {
    acc = submitMarketOrder(
      acc,
      step.side,
      unitsToQty(step.units),
      quote(step.price, T0 + step.minute * MINUTE),
    ).account;
  }
  return acc.executions;
}

beforeEach(() => resetIdSequence());

describe('round trips', () => {
  it('a simple long open and close is one trip', () => {
    const trips = buildTrips(
      run([
        { side: 'buy', units: 1, price: 4_000_000, minute: 0 },
        { side: 'sell', units: 1, price: 4_100_000, minute: 30 },
      ]),
    );
    expect(trips).toHaveLength(1);
    const trip = trips[0]!;
    expect(trip.direction).toBe('long');
    expect(tripUnits(trip)).toBe(1);
    expect(trip.avgEntryCents).toBe(4_000_000);
    expect(trip.avgExitCents).toBe(4_100_000);
    expect(trip.netCents).toBe(100_000);
    expect(trip.durationMs).toBe(30 * MINUTE);
    expect(trip.fills).toBe(2);
    expect(trip.liquidated).toBe(false);
  });

  it('a short trip reports its direction and profit correctly', () => {
    const trips = buildTrips(
      run([
        { side: 'sell', units: 2, price: 4_000_000, minute: 0 },
        { side: 'buy', units: 2, price: 3_900_000, minute: 10 },
      ]),
    );
    expect(trips[0]?.direction).toBe('short');
    expect(trips[0]?.netCents).toBe(200_000);
  });

  it('an open position is not yet a trip', () => {
    const trips = buildTrips(run([{ side: 'buy', units: 1, price: 4_000_000, minute: 0 }]));
    expect(trips).toHaveLength(0);
  });

  it('scaling in averages the entry and keeps one trip', () => {
    const trips = buildTrips(
      run([
        { side: 'buy', units: 1, price: 4_000_000, minute: 0 },
        { side: 'buy', units: 1, price: 4_200_000, minute: 5 },
        { side: 'sell', units: 2, price: 4_300_000, minute: 20 },
      ]),
    );
    expect(trips).toHaveLength(1);
    expect(trips[0]?.avgEntryCents).toBe(4_100_000);
    expect(tripUnits(trips[0]!)).toBe(2);
    expect(trips[0]?.netCents).toBe(400_000);
    expect(trips[0]?.fills).toBe(3);
  });

  it('scaling out averages the exit and stays one trip', () => {
    const trips = buildTrips(
      run([
        { side: 'buy', units: 2, price: 4_000_000, minute: 0 },
        { side: 'sell', units: 1, price: 4_100_000, minute: 10 },
        { side: 'sell', units: 1, price: 4_300_000, minute: 20 },
      ]),
    );
    expect(trips).toHaveLength(1);
    expect(trips[0]?.avgExitCents).toBe(4_200_000);
    expect(trips[0]?.netCents).toBe(400_000);
    expect(trips[0]?.closedAt).toBe(T0 + 20 * MINUTE);
  });

  it('a reversal closes one trip and opens the next at the same fill', () => {
    const trips = buildTrips(
      run([
        { side: 'buy', units: 1, price: 4_000_000, minute: 0 },
        { side: 'sell', units: 3, price: 4_100_000, minute: 15 },
        { side: 'buy', units: 2, price: 4_050_000, minute: 40 },
      ]),
    );
    expect(trips).toHaveLength(2);
    expect(trips[0]?.direction).toBe('long');
    expect(trips[0]?.netCents).toBe(100_000);
    expect(trips[1]?.direction).toBe('short');
    expect(trips[1]?.openedAt).toBe(T0 + 15 * MINUTE);
    expect(tripUnits(trips[1]!)).toBe(2);
    // Sold 2 at 4,100,000 and bought them back at 4,050,000.
    expect(trips[1]?.netCents).toBe(100_000);
  });

  it('counts commission against the trip', () => {
    let acc = createAccount('a', 'T', { ...DEFAULT_SETTINGS, spread: false, slippage: false }, T0);
    acc = submitMarketOrder(acc, 'buy', unitsToQty(1), quote(4_000_000)).account;
    acc = submitMarketOrder(acc, 'sell', unitsToQty(1), quote(4_100_000, T0 + MINUTE)).account;
    const trip = buildTrips(acc.executions)[0]!;
    expect(trip.grossCents).toBe(100_000);
    // 0.055% of $40,000 plus 0.055% of $41,000.
    expect(trip.feesCents).toBe(2_200 + 2_255);
    expect(trip.netCents).toBe(100_000 - 4_455);
  });

  it('flags a trip that ended in liquidation', () => {
    const executions: Execution[] = [
      {
        id: 'x1',
        orderId: 'o1',
        time: T0,
        side: 'buy',
        qty: unitsToQty(1),
        priceCents: 4_000_000,
        feeCents: 0,
        realisedCents: 0,
      },
      {
        id: 'x2',
        orderId: 'o2',
        time: T0 + MINUTE,
        side: 'sell',
        qty: unitsToQty(1),
        priceCents: 3_600_000,
        feeCents: 0,
        realisedCents: -400_000,
        system: true,
      },
    ];
    const trip = buildTrips(executions)[0]!;
    expect(trip.liquidated).toBe(true);
    expect(trip.netCents).toBe(-400_000);
  });

  it('handles an empty stream', () => {
    expect(buildTrips([])).toEqual([]);
  });

  it('keeps trips in the order they closed', () => {
    const trips = buildTrips(
      run([
        { side: 'buy', units: 1, price: 4_000_000, minute: 0 },
        { side: 'sell', units: 1, price: 4_100_000, minute: 5 },
        { side: 'sell', units: 1, price: 4_100_000, minute: 10 },
        { side: 'buy', units: 1, price: 4_000_000, minute: 15 },
      ]),
    );
    expect(trips.map((t) => t.direction)).toEqual(['long', 'short']);
    expect(trips[0]!.closedAt).toBeLessThan(trips[1]!.closedAt);
  });
});

describe('statistics', () => {
  /** Three winners and two losers, in a deliberate order. */
  function sample() {
    return buildTrips(
      run([
        { side: 'buy', units: 1, price: 4_000_000, minute: 0 },
        { side: 'sell', units: 1, price: 4_100_000, minute: 5 }, // +1000
        { side: 'buy', units: 1, price: 4_100_000, minute: 10 },
        { side: 'sell', units: 1, price: 4_050_000, minute: 15 }, // -500
        { side: 'buy', units: 1, price: 4_050_000, minute: 20 },
        { side: 'sell', units: 1, price: 4_250_000, minute: 25 }, // +2000
        { side: 'buy', units: 1, price: 4_250_000, minute: 30 },
        { side: 'sell', units: 1, price: 4_150_000, minute: 35 }, // -1000
        { side: 'buy', units: 1, price: 4_150_000, minute: 40 },
        { side: 'sell', units: 1, price: 4_200_000, minute: 45 }, // +500
      ]),
    );
  }

  it('counts wins and losses and the win rate', () => {
    const s = tradeStats(sample());
    expect(s.trips).toBe(5);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(2);
    expect(s.winRate).toBeCloseTo(0.6);
  });

  it('averages wins and losses separately', () => {
    const s = tradeStats(sample());
    // (100,000 + 200,000 + 50,000) / 3
    expect(s.avgWinCents).toBe(Math.round(350_000 / 3));
    // (-50,000 + -100,000) / 2
    expect(s.avgLossCents).toBe(-75_000);
  });

  it('reports the largest win and loss', () => {
    const s = tradeStats(sample());
    expect(s.largestWinCents).toBe(200_000);
    expect(s.largestLossCents).toBe(-100_000);
  });

  it('computes profit factor and expectancy', () => {
    const s = tradeStats(sample());
    expect(s.grossProfitCents).toBe(350_000);
    expect(s.grossLossCents).toBe(150_000);
    expect(s.profitFactor).toBeCloseTo(350_000 / 150_000);
    expect(s.netCents).toBe(200_000);
    expect(s.expectancyCents).toBe(40_000);
  });

  it('profit factor is infinite with no losses and zero with no wins', () => {
    const onlyWins = tradeStats(
      buildTrips(
        run([
          { side: 'buy', units: 1, price: 4_000_000, minute: 0 },
          { side: 'sell', units: 1, price: 4_100_000, minute: 1 },
        ]),
      ),
    );
    expect(onlyWins.profitFactor).toBe(Number.POSITIVE_INFINITY);

    const onlyLosses = tradeStats(
      buildTrips(
        run([
          { side: 'buy', units: 1, price: 4_100_000, minute: 0 },
          { side: 'sell', units: 1, price: 4_000_000, minute: 1 },
        ]),
      ),
    );
    expect(onlyLosses.profitFactor).toBe(0);
  });

  it('measures the deepest fall from a peak', () => {
    const s = tradeStats(sample());
    // Curve: +1000, +500, +2500, +1500, +2000. The peak is 2500 and the
    // trough after it is 1500, so the worst drawdown is 1000.
    expect(s.maxDrawdownCents).toBe(100_000);
  });

  it('tracks the longest winning and losing runs', () => {
    const trips = buildTrips(
      run([
        { side: 'buy', units: 1, price: 4_000_000, minute: 0 },
        { side: 'sell', units: 1, price: 4_010_000, minute: 1 }, // win
        { side: 'buy', units: 1, price: 4_010_000, minute: 2 },
        { side: 'sell', units: 1, price: 4_020_000, minute: 3 }, // win
        { side: 'buy', units: 1, price: 4_020_000, minute: 4 },
        { side: 'sell', units: 1, price: 4_030_000, minute: 5 }, // win
        { side: 'buy', units: 1, price: 4_030_000, minute: 6 },
        { side: 'sell', units: 1, price: 4_020_000, minute: 7 }, // loss
        { side: 'buy', units: 1, price: 4_020_000, minute: 8 },
        { side: 'sell', units: 1, price: 4_010_000, minute: 9 }, // loss
      ]),
    );
    const s = tradeStats(trips);
    expect(s.bestStreak).toBe(3);
    expect(s.worstStreak).toBe(2);
  });

  it('an empty set of trips reports zeroes, not NaN', () => {
    const s = tradeStats([]);
    expect(s.trips).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.expectancyCents).toBe(0);
    expect(Number.isNaN(s.profitFactor)).toBe(false);
  });

  it('a scratch trip counts as neither a win nor a loss', () => {
    const trips = buildTrips(
      run([
        { side: 'buy', units: 1, price: 4_000_000, minute: 0 },
        { side: 'sell', units: 1, price: 4_000_000, minute: 1 },
      ]),
    );
    const s = tradeStats(trips);
    expect(s.trips).toBe(1);
    expect(s.wins).toBe(0);
    expect(s.losses).toBe(0);
    expect(s.winRate).toBe(0);
  });
});

describe('equity curve', () => {
  it('starts at the opening balance and steps with each trip', () => {
    const trips = buildTrips(
      run([
        { side: 'buy', units: 1, price: 4_000_000, minute: 0 },
        { side: 'sell', units: 1, price: 4_100_000, minute: 1 },
        { side: 'buy', units: 1, price: 4_100_000, minute: 2 },
        { side: 'sell', units: 1, price: 4_050_000, minute: 3 },
      ]),
    );
    const curve = equityCurve(trips, 10_000_000);
    expect(curve).toEqual([10_000_000, 10_100_000, 10_050_000]);
  });

  it('is just the starting balance with no trips', () => {
    expect(equityCurve([], 500)).toEqual([500]);
  });
});

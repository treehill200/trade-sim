import { useEffect } from 'react';
import { marketClient } from '@/state/marketClient';
import { useTrading } from '@/state/tradingStore';
import type { Quote } from '@/trading/types';

/** The live quote in the shape the trading engine expects. */
export function currentQuote(): Quote {
  const q = marketClient.quote;
  const last = q.last || marketClient.series.lastClose() || 0;
  return {
    timeMs: q.time || Date.now(),
    lastCents: last,
    bidCents: q.bid || last,
    askCents: q.ask || last,
    volFactor: q.volFactor || 1,
  };
}

/**
 * Mark the account to market on every price update.
 *
 * Liquidation has to be checked against prices as they arrive, not when the
 * user next looks at the screen, so this runs off the market feed rather than
 * a render.
 */
export function useMarkToMarket(): void {
  useEffect(() => {
    let last = 0;
    return marketClient.onData(() => {
      const now = performance.now();
      // Four times a second is every print; more often would be pointless.
      if (now - last < 200) return;
      last = now;
      const quote = currentQuote();
      if (quote.lastCents > 0) useTrading.getState().markToMarket(quote);
    });
  }, []);
}

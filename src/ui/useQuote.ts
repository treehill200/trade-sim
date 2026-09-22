import { useEffect } from 'react';
import { marketClient } from '@/state/marketClient';
import { playAlertTone, useAlerts } from '@/state/alertsStore';
import { notify } from '@/state/notifications';
import { useTrading } from '@/state/tradingStore';
import { formatCents } from '@/chart/format';
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
    let previousPrice = 0;
    return marketClient.onData(() => {
      const now = performance.now();
      // Four times a second is every print; more often would be pointless.
      if (now - last < 200) return;
      last = now;
      const quote = currentQuote();
      if (quote.lastCents <= 0) return;

      // Price alerts are checked against the range covered since the previous
      // sample, so a fast move cannot slip past one between two ticks.
      const low = Math.min(previousPrice || quote.lastCents, quote.lastCents);
      const high = Math.max(previousPrice || quote.lastCents, quote.lastCents);
      previousPrice = quote.lastCents;
      const fired = useAlerts.getState().check(low, high, quote.timeMs);
      for (const alert of fired) {
        notify({
          tone: 'warning',
          title: `Alert: DAVID ${alert.direction === 'above' ? 'rose above' : 'fell below'} ${formatCents(alert.priceCents)}`,
          body: `Now ${formatCents(quote.lastCents)}`,
        });
      }
      if (fired.length > 0 && useAlerts.getState().sound) playAlertTone();

      useTrading.getState().markToMarket(quote);
    });
  }, []);
}

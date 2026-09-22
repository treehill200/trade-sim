import { RotateCcw, Shield, Target, X } from 'lucide-react';
import { chartMapping } from '@/chart/chartMapping';
import { marketClient } from '@/state/marketClient';
import { useTrading } from '@/state/tradingStore';
import { chartLines } from '@/trading/chartLines';
import { accountMetrics } from '@/trading/metrics';
import { defaultBracketPrices } from '@/trading/orders';
import { currentQuote } from './useQuote';
import { useMarketPulse } from './useMarket';

/**
 * The buttons that live on the chart's order and position lines.
 *
 * Drawn as HTML rather than into the canvas so they are real buttons with real
 * hit areas and real hover states. They read the chart's mapping directly and
 * re-render on a throttled pulse, which is smooth enough for a control while
 * costing the render loop nothing.
 */
export function OrderLineControls(): JSX.Element | null {
  useMarketPulse(12);
  const account = useTrading((s) => s.active());
  const cancelOrder = useTrading((s) => s.cancelOrder);
  const closePosition = useTrading((s) => s.closePosition);
  const reversePosition = useTrading((s) => s.reversePosition);
  const setBrackets = useTrading((s) => s.setBrackets);

  const { map, bounds, axisWidth } = chartMapping;
  if (!map || bounds.height === 0) return null;

  const quote = currentQuote();
  if (quote.lastCents <= 0) return null;
  const metrics = accountMetrics(account, quote);
  const lines = chartLines(account, metrics);
  if (lines.length === 0) return null;

  const hasExits = account.orders.some((o) => o.status === 'working' && o.tag && o.reduceOnly);

  return (
    <div className="order-line-controls" style={{ right: axisWidth + 6 }}>
      {lines.map((line) => {
        const y = map.yOfPrice(line.priceCents);
        if (y < bounds.top + 6 || y > bounds.top + bounds.height - 6) return null;

        if (line.kind === 'entry') {
          return (
            <div key={line.id} className="line-controls" style={{ top: y - 11 }}>
              {!hasExits && (
                <button
                  title="Add a take-profit and stop-loss around this position"
                  onClick={() =>
                    setBrackets(
                      defaultBracketPrices(metrics.averageEntryCents, account.position.qty),
                    )
                  }
                >
                  <Target size={12} />
                  TP/SL
                </button>
              )}
              <button title="Reverse the position" onClick={() => reversePosition(currentQuote())}>
                <RotateCcw size={12} />
              </button>
              <button
                className="danger"
                title="Close the position at market"
                onClick={() => closePosition(currentQuote())}
              >
                <X size={12} />
              </button>
            </div>
          );
        }

        if (line.kind === 'liquidation') {
          return (
            <div key={line.id} className="line-controls muted" style={{ top: y - 11 }}>
              <span className="line-badge" title="Equity reaches the maintenance requirement here">
                <Shield size={11} />
              </span>
            </div>
          );
        }

        return (
          <div key={line.id} className="line-controls" style={{ top: y - 11 }}>
            <button
              className="danger"
              title="Cancel this order"
              onClick={() => line.orderId && cancelOrder(line.orderId)}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Kept so the overlay only mounts once the market has a price. */
export function hasLivePrice(): boolean {
  return (marketClient.quote.last || 0) > 0;
}

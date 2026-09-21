import { useCallback, useEffect, useState } from 'react';
import { marketClient } from '@/state/marketClient';
import { formatCents } from '@/chart/format';
import { useMarketPulse } from './useMarket';

/**
 * Quick Sell/Buy buttons in the chart's top-left corner.
 *
 * The live bid, ask and spread are real; the buttons themselves are wired up
 * once the trading engine lands, and say so if you press them before then.
 */
export function QuickTrade(): JSX.Element | null {
  useMarketPulse(8);
  const [hint, setHint] = useState(false);
  const q = marketClient.quote;

  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(false), 2600);
    return () => clearTimeout(id);
  }, [hint]);

  const notYet = useCallback(() => setHint(true), []);

  if (!q.bid || !q.ask) return null;

  return (
    <div className="quick-trade">
      <button className="qt-button qt-sell" onClick={notYet}>
        <span className="qt-label">Sell</span>
        <span className="qt-price">{formatCents(q.bid)}</span>
      </button>
      <div className="qt-spread">
        <span>{formatCents(q.spread)}</span>
      </div>
      <button className="qt-button qt-buy" onClick={notYet}>
        <span className="qt-label">Buy</span>
        <span className="qt-price">{formatCents(q.ask)}</span>
      </button>
      {hint && <div className="qt-hint">Trading arrives in a later phase</div>}
    </div>
  );
}

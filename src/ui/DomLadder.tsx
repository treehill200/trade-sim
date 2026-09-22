import { useState } from 'react';
import { formatCents } from '@/chart/format';
import { marketClient } from '@/state/marketClient';
import { useTrading } from '@/state/tradingStore';
import { qtyToUnits, unitsToQty } from '@/trading/money';
import { currentQuote } from './useQuote';
import { useMarketPulse } from './useMarket';

/**
 * Live depth ladder you can trade from.
 *
 * A click places a limit order at that level — buy on the bid side, sell on
 * the ask side, which is what a resting order at that price means. Holding
 * shift places a stop instead: a buy stop above the market or a sell stop
 * below it, the two orders that trigger on a breakout rather than a pullback.
 */
export function DomLadder(): JSX.Element {
  useMarketPulse(6);
  const [sizeText, setSizeText] = useState('0.1');
  const submit = useTrading((s) => s.submit);

  const book = marketClient.book;
  const asks = [...book.asks].reverse();
  const maxSize = Math.max(0.001, ...book.bids.map((l) => l.size), ...book.asks.map((l) => l.size));
  const qty = unitsToQty(Math.max(0, Number(sizeText) || 0));

  const place = (priceCents: number, side: 'bid' | 'ask', shift: boolean): void => {
    if (qty <= 0) return;
    const quote = currentQuote();
    if (shift) {
      // Stops break out: buy above the market, sell below it.
      const above = priceCents > quote.lastCents;
      submit(
        { side: above ? 'buy' : 'sell', type: 'stop', qty, stopCents: priceCents },
        quote,
      );
      return;
    }
    submit(
      { side: side === 'bid' ? 'buy' : 'sell', type: 'limit', qty, limitCents: priceCents },
      quote,
    );
  };

  return (
    <div className="dom">
      <div className="dom-size">
        <label htmlFor="dom-size">Size</label>
        <input
          id="dom-size"
          inputMode="decimal"
          value={sizeText}
          onChange={(e) => setSizeText(e.target.value)}
        />
        <span>{qtyToUnits(qty).toFixed(4)} DAVID</span>
      </div>
      <div className="dom-head">
        <span>Price</span>
        <span>Size</span>
      </div>
      <div className="dom-rows">
        {asks.map((level) => (
          <Row
            key={`a${level.price}`}
            price={level.price}
            size={level.size}
            max={maxSize}
            side="ask"
            onPlace={place}
          />
        ))}
        <div className="dom-spread">
          <span>{formatCents(book.spread || 0)}</span>
          <em>spread</em>
        </div>
        {book.bids.map((level) => (
          <Row
            key={`b${level.price}`}
            price={level.price}
            size={level.size}
            max={maxSize}
            side="bid"
            onPlace={place}
          />
        ))}
      </div>
      <div className="dom-note">
        Click a level for a limit order there. Hold shift for a stop.
      </div>
    </div>
  );
}

function Row({
  price,
  size,
  max,
  side,
  onPlace,
}: {
  price: number;
  size: number;
  max: number;
  side: 'bid' | 'ask';
  onPlace: (priceCents: number, side: 'bid' | 'ask', shift: boolean) => void;
}): JSX.Element {
  return (
    <button
      className={`dom-row ${side}`}
      onClick={(e) => onPlace(price, side, e.shiftKey)}
      title={`${side === 'bid' ? 'Buy' : 'Sell'} limit at ${formatCents(price)} — shift for a stop`}
    >
      <span className="dom-bar" style={{ width: `${Math.min(100, (size / max) * 100)}%` }} />
      <span className="dom-price">{formatCents(price)}</span>
      <span className="dom-size-cell">{size.toFixed(3)}</span>
    </button>
  );
}

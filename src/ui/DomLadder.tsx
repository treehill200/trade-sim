import { formatCents } from '@/chart/format';
import { marketClient } from '@/state/marketClient';
import { useMarketPulse } from './useMarket';

/**
 * Live depth ladder.
 *
 * Read-only for now: clicking a level to place an order needs resting order
 * types, which arrive with limit and stop orders in the next phase.
 */
export function DomLadder(): JSX.Element {
  useMarketPulse(6);
  const book = marketClient.book;
  const asks = [...book.asks].reverse();
  const maxSize = Math.max(
    0.001,
    ...book.bids.map((l) => l.size),
    ...book.asks.map((l) => l.size),
  );

  return (
    <div className="dom">
      <div className="dom-head">
        <span>Price</span>
        <span>Size</span>
      </div>
      <div className="dom-rows">
        {asks.map((level) => (
          <Row key={`a${level.price}`} price={level.price} size={level.size} max={maxSize} side="ask" />
        ))}
        <div className="dom-spread">
          <span>{formatCents(book.spread || 0)}</span>
          <em>spread</em>
        </div>
        {book.bids.map((level) => (
          <Row key={`b${level.price}`} price={level.price} size={level.size} max={maxSize} side="bid" />
        ))}
      </div>
      <div className="dom-note">Clicking a level to place an order arrives in the next phase.</div>
    </div>
  );
}

function Row({
  price,
  size,
  max,
  side,
}: {
  price: number;
  size: number;
  max: number;
  side: 'bid' | 'ask';
}): JSX.Element {
  return (
    <div className={`dom-row ${side}`}>
      <span className="dom-bar" style={{ width: `${Math.min(100, (size / max) * 100)}%` }} />
      <span className="dom-price">{formatCents(price)}</span>
      <span className="dom-size">{size.toFixed(3)}</span>
    </div>
  );
}

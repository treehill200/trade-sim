import { useMemo, useState } from 'react';
import { Settings } from 'lucide-react';
import { formatCents } from '@/chart/format';
import { useTrading } from '@/state/tradingStore';
import { accountMetrics } from '@/trading/metrics';
import {
  centsToDollars,
  dollarsToCents,
  notional,
  qtyFromNotional,
  qtyToUnits,
  tickValue,
  unitsToQty,
  type Qty,
} from '@/trading/money';
import type { OrderType, Side } from '@/trading/types';
import { currentQuote } from './useQuote';
import { useMarketPulse } from './useMarket';
import { DomLadder } from './DomLadder';
import { AccountSettingsDialog } from './AccountSettingsDialog';

type SizeMode = 'qty' | 'usd' | 'percent';
type PanelTab = 'order' | 'dom';

const SIZE_MODES: { id: SizeMode; label: string }[] = [
  { id: 'qty', label: 'DAVID' },
  { id: 'usd', label: 'USD' },
  { id: 'percent', label: '%' },
];

const ORDER_TYPES: { id: OrderType; label: string }[] = [
  { id: 'market', label: 'Market' },
  { id: 'limit', label: 'Limit' },
  { id: 'stop', label: 'Stop' },
];

export function OrderPanel(): JSX.Element {
  useMarketPulse(6);
  const [tab, setTab] = useState<PanelTab>('order');
  const [side, setSide] = useState<Side>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [sizeMode, setSizeMode] = useState<SizeMode>('qty');
  const [sizeText, setSizeText] = useState('0.5');
  const [priceText, setPriceText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const account = useTrading((s) => s.active());
  const submitMarket = useTrading((s) => s.submitMarket);
  const quote = currentQuote();
  const metrics = accountMetrics(account, quote);

  const referenceCents = side === 'buy' ? quote.askCents : quote.bidCents;

  /** Quantity the entered size means, whichever unit it was typed in. */
  const qty: Qty = useMemo(() => {
    const value = Number(sizeText);
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (sizeMode === 'qty') return unitsToQty(value);
    if (sizeMode === 'usd') return qtyFromNotional(dollarsToCents(value), referenceCents || 1);
    // Percent of what the account could put to work at its leverage.
    const budget = Math.max(0, metrics.availableCents) * account.settings.leverage;
    return qtyFromNotional(Math.round((budget * value) / 100), referenceCents || 1);
  }, [sizeText, sizeMode, referenceCents, metrics.availableCents, account.settings.leverage]);

  const tradeValue = Math.abs(notional(referenceCents, qty));
  const requiredMargin = Math.ceil(tradeValue / Math.max(1, account.settings.leverage));
  const enoughMargin = requiredMargin <= metrics.availableCents;
  const marketReady = orderType === 'market' && qty > 0;

  const submit = (): void => {
    if (!marketReady) return;
    submitMarket(side, qty, currentQuote());
  };

  const nudgePrice = (ticks: number): void => {
    const base = Number(priceText) > 0 ? dollarsToCents(Number(priceText)) : referenceCents;
    setPriceText(centsToDollars(base + ticks).toFixed(2));
  };

  return (
    <aside className="order-panel">
      <div className="panel-tabs">
        <button className={tab === 'order' ? 'active' : ''} onClick={() => setTab('order')}>
          Order
        </button>
        <button className={tab === 'dom' ? 'active' : ''} onClick={() => setTab('dom')}>
          DOM
        </button>
        <button className="icon-button panel-settings" title="Account settings" onClick={() => setSettingsOpen(true)}>
          <Settings size={15} />
        </button>
      </div>

      {tab === 'dom' ? (
        <DomLadder />
      ) : (
        <div className="panel-body">
          <div className="side-toggle">
            <button
              className={`side-button sell ${side === 'sell' ? 'active' : ''}`}
              onClick={() => setSide('sell')}
            >
              <span className="side-label">Sell</span>
              <span className="side-price">{formatCents(quote.bidCents)}</span>
            </button>
            <div className="side-spread">
              <em>Spread</em>
              <b>{formatCents(Math.max(0, quote.askCents - quote.bidCents))}</b>
            </div>
            <button
              className={`side-button buy ${side === 'buy' ? 'active' : ''}`}
              onClick={() => setSide('buy')}
            >
              <span className="side-label">Buy</span>
              <span className="side-price">{formatCents(quote.askCents)}</span>
            </button>
          </div>

          <div className="segmented">
            {ORDER_TYPES.map((t) => (
              <button
                key={t.id}
                className={orderType === t.id ? 'active' : ''}
                onClick={() => setOrderType(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {orderType !== 'market' && (
            <div className="field">
              <label htmlFor="order-price">{orderType === 'stop' ? 'Stop price' : 'Limit price'}</label>
              <div className="field-row">
                <input
                  id="order-price"
                  inputMode="decimal"
                  value={priceText}
                  placeholder={centsToDollars(referenceCents).toFixed(2)}
                  onChange={(e) => setPriceText(e.target.value)}
                />
                <div className="tick-nudge">
                  <button onClick={() => nudgePrice(10)} title="Up 10 ticks">
                    +10
                  </button>
                  <button onClick={() => nudgePrice(-10)} title="Down 10 ticks">
                    −10
                  </button>
                </div>
              </div>
              <button className="field-hint-button" onClick={() => setPriceText(centsToDollars(referenceCents).toFixed(2))}>
                Use {side === 'buy' ? 'ask' : 'bid'} {formatCents(referenceCents)}
              </button>
            </div>
          )}

          <div className="field">
            <label htmlFor="order-size">Size</label>
            <div className="field-row">
              <input
                id="order-size"
                inputMode="decimal"
                value={sizeText}
                onChange={(e) => setSizeText(e.target.value)}
              />
              <div className="segmented small">
                {SIZE_MODES.map((m) => (
                  <button
                    key={m.id}
                    className={sizeMode === m.id ? 'active' : ''}
                    onClick={() => setSizeMode(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {sizeMode !== 'qty' && (
              <div className="field-hint">= {qtyToUnits(qty).toFixed(6)} DAVID</div>
            )}
          </div>

          <dl className="summary">
            <div>
              <dt>Trade value</dt>
              <dd>
                {formatCents(tradeValue)}
                <em>{account.settings.leverage}x</em>
              </dd>
            </div>
            <div>
              <dt>Required margin</dt>
              <dd className={enoughMargin ? '' : 'down'}>{formatCents(requiredMargin)}</dd>
            </div>
            <div>
              <dt>Available margin</dt>
              <dd>{formatCents(Math.max(0, metrics.availableCents))}</dd>
            </div>
            <div>
              <dt>Tick value</dt>
              <dd>{formatCents(tickValue(qty, 1))}</dd>
            </div>
          </dl>

          <div className="exits-placeholder">
            Take-profit and stop-loss brackets arrive in the next phase.
          </div>

          <button
            className={`submit-button ${side}`}
            onClick={submit}
            disabled={!marketReady || !enoughMargin}
          >
            {orderType !== 'market' ? (
              <span className="submit-main">{ORDER_TYPES.find((t) => t.id === orderType)?.label} orders arrive next phase</span>
            ) : (
              <>
                <span className="submit-main">
                  {side === 'buy' ? 'Buy' : 'Sell'} {qtyToUnits(qty).toFixed(4)} DAVID
                </span>
                <span className="submit-sub">
                  {formatCents(tradeValue)} · margin {formatCents(requiredMargin)}
                </span>
              </>
            )}
          </button>
          {!enoughMargin && marketReady && (
            <div className="field-error">Not enough available margin for this size.</div>
          )}
        </div>
      )}

      {settingsOpen && <AccountSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}

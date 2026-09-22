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
import type { OrderRequest, OrderType, Side } from '@/trading/types';
import {
  DEFAULT_STOP_LOSS,
  DEFAULT_TAKE_PROFIT,
  ExitRow,
  exitPrice,
  type ExitState,
} from './ExitsSection';
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
  { id: 'stopLimit', label: 'Stop lmt' },
];

export function OrderPanel(): JSX.Element {
  useMarketPulse(6);
  const [tab, setTab] = useState<PanelTab>('order');
  const [side, setSide] = useState<Side>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [sizeMode, setSizeMode] = useState<SizeMode>('qty');
  const [sizeText, setSizeText] = useState('0.5');
  const [priceText, setPriceText] = useState('');
  const [stopText, setStopText] = useState('');
  const [takeProfit, setTakeProfit] = useState<ExitState>(DEFAULT_TAKE_PROFIT);
  const [stopLoss, setStopLoss] = useState<ExitState>(DEFAULT_STOP_LOSS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const account = useTrading((s) => s.active());
  const submit_ = useTrading((s) => s.submit);
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

  const limitCents = Number(priceText) > 0 ? dollarsToCents(Number(priceText)) : undefined;
  const stopCents = Number(stopText) > 0 ? dollarsToCents(Number(stopText)) : undefined;

  /** The price the order is expected to get, used to derive the exits. */
  const entryCents =
    orderType === 'limit'
      ? (limitCents ?? referenceCents)
      : orderType === 'stop' || orderType === 'stopLimit'
        ? (stopCents ?? referenceCents)
        : referenceCents;

  const long = side === 'buy';
  const tpCents = exitPrice(takeProfit, entryCents, qty, long, true);
  const slCents = exitPrice(stopLoss, entryCents, qty, long, false);

  const tradeValue = Math.abs(notional(entryCents, qty));
  const requiredMargin = Math.ceil(tradeValue / Math.max(1, account.settings.leverage));
  const enoughMargin = requiredMargin <= metrics.availableCents;

  const needsLimit = orderType === 'limit' || orderType === 'stopLimit';
  const needsStop = orderType === 'stop' || orderType === 'stopLimit';
  const missingPrice = (needsLimit && limitCents === undefined) || (needsStop && stopCents === undefined);
  const ready = qty > 0 && !missingPrice;

  const submit = (): void => {
    if (!ready) return;
    const request: OrderRequest = {
      side,
      type: orderType,
      qty,
      ...(needsLimit && limitCents !== undefined ? { limitCents } : {}),
      ...(needsStop && stopCents !== undefined ? { stopCents } : {}),
      ...(tpCents !== undefined ? { takeProfitCents: tpCents } : {}),
      ...(slCents !== undefined ? { stopLossCents: slCents } : {}),
    };
    submit_(request, currentQuote());
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

          {needsStop && (
            <PriceField
              id="order-stop"
              label="Stop price"
              value={stopText}
              placeholder={centsToDollars(referenceCents).toFixed(2)}
              referenceCents={referenceCents}
              referenceLabel={side === 'buy' ? 'ask' : 'bid'}
              onChange={setStopText}
            />
          )}
          {needsLimit && (
            <PriceField
              id="order-price"
              label="Limit price"
              value={priceText}
              placeholder={centsToDollars(referenceCents).toFixed(2)}
              referenceCents={referenceCents}
              referenceLabel={side === 'buy' ? 'ask' : 'bid'}
              onChange={setPriceText}
            />
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

          <div className="exits">
            <div className="exits-title">Exits</div>
            <ExitRow
              label="Take profit"
              exit={takeProfit}
              onChange={setTakeProfit}
              resolvedCents={tpCents}
              tone="up"
            />
            <ExitRow
              label="Stop loss"
              exit={stopLoss}
              onChange={setStopLoss}
              resolvedCents={slCents}
              tone="down"
            />
          </div>

          <button
            className={`submit-button ${side}`}
            onClick={submit}
            disabled={!ready || !enoughMargin}
          >
            <span className="submit-main">
              {side === 'buy' ? 'Buy' : 'Sell'} {qtyToUnits(qty).toFixed(4)} DAVID
              {orderType === 'market' ? '' : ` · ${ORDER_TYPES.find((t) => t.id === orderType)?.label}`}
            </span>
            <span className="submit-sub">
              {formatCents(tradeValue)} · margin {formatCents(requiredMargin)}
              {tpCents !== undefined ? ` · TP ${formatCents(tpCents)}` : ''}
              {slCents !== undefined ? ` · SL ${formatCents(slCents)}` : ''}
            </span>
          </button>
          {!enoughMargin && qty > 0 && (
            <div className="field-error">Not enough available margin for this size.</div>
          )}
          {missingPrice && <div className="field-error">Enter a price for this order type.</div>}
        </div>
      )}

      {settingsOpen && <AccountSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}

/**
 * A price input with a bid/ask helper and tick nudges.
 *
 * Shared by the limit and stop fields so a stop-limit order's two prices
 * behave identically.
 */
function PriceField({
  id,
  label,
  value,
  placeholder,
  referenceCents,
  referenceLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  referenceCents: number;
  referenceLabel: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const nudge = (ticks: number): void => {
    const base = Number(value) > 0 ? dollarsToCents(Number(value)) : referenceCents;
    onChange(centsToDollars(Math.max(1, base + ticks)).toFixed(2));
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-row">
        <input
          id={id}
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="tick-nudge">
          <button onClick={() => nudge(100)} title="Up 100 ticks ($1.00)">
            +100
          </button>
          <button onClick={() => nudge(-100)} title="Down 100 ticks ($1.00)">
            −100
          </button>
        </div>
      </div>
      <button
        className="field-hint-button"
        onClick={() => onChange(centsToDollars(referenceCents).toFixed(2))}
      >
        Use {referenceLabel} {formatCents(referenceCents)}
      </button>
    </div>
  );
}

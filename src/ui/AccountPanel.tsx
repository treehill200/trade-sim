import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Trash2, X } from 'lucide-react';
import { formatCents, formatPercent, formatSignedCents } from '@/chart/format';
import { useTrading } from '@/state/tradingStore';
import { accountMetrics } from '@/trading/metrics';
import { buildTrips, equityCurve, tradeStats, tripUnits, type Trip } from '@/trading/journal';
import { qtyToUnits } from '@/trading/money';
import type { Execution, Order } from '@/trading/types';
import { currentQuote } from './useQuote';
import { useMarketPulse } from './useMarket';
import { AccountSwitcher } from './AccountSwitcher';
import { EquityCurve } from './EquityCurve';

type Tab = 'positions' | 'orders' | 'history' | 'journal' | 'stats';

const TABS: { id: Tab; label: string }[] = [
  { id: 'positions', label: 'Positions' },
  { id: 'orders', label: 'Working Orders' },
  { id: 'history', label: 'Order History' },
  { id: 'journal', label: 'Trade Journal' },
  { id: 'stats', label: 'Stats' },
];

/** Milliseconds rendered as the shortest sensible unit. */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Minimum and maximum height of the panel when open, in pixels. */
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 520;
const DEFAULT_HEIGHT = 210;

export function AccountPanel(): JSX.Element {
  useMarketPulse(5);
  const [tab, setTab] = useState<Tab>('positions');
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);

  const account = useTrading((s) => s.active());
  const closePosition = useTrading((s) => s.closePosition);
  const reversePosition = useTrading((s) => s.reversePosition);
  const cancelOrder = useTrading((s) => s.cancelOrder);
  const cancelAll = useTrading((s) => s.cancelAll);
  const setNote = useTrading((s) => s.setNote);
  const reset = useTrading((s) => s.reset);
  const quote = currentQuote();
  const metrics = accountMetrics(account, quote);

  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startHeight = height;
    const move = (ev: PointerEvent): void => {
      // Dragging up makes the panel taller.
      const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight - (ev.clientY - startY)));
      setHeight(next);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const workingOrders = account.orders.filter((o) => o.status === 'working');
  const history = [...account.orders].reverse().slice(0, 200);
  // Round trips and statistics are derived, so they can never disagree with
  // the order history they come from.
  const trips = useMemo(() => buildTrips(account.executions), [account.executions]);
  const stats = useMemo(() => tradeStats(trips), [trips]);
  const curve = useMemo(
    () => equityCurve(trips, account.settings.startingBalanceCents),
    [trips, account.settings.startingBalanceCents],
  );

  return (
    <section className="account-panel" style={{ height: collapsed ? 34 : height + 34 }}>
      {!collapsed && <div className="panel-resizer" onPointerDown={startResize} />}

      <div className="account-summary">
        <Metric label="Balance" value={formatCents(metrics.balanceCents)} />
        <Metric label="Equity" value={formatCents(metrics.equityCents)} />
        <Metric
          label="Realised P&L"
          value={formatSignedCents(metrics.realisedPnlCents)}
          tone={metrics.realisedPnlCents}
        />
        <Metric
          label="Unrealised P&L"
          value={formatSignedCents(metrics.unrealisedPnlCents)}
          tone={metrics.unrealisedPnlCents}
        />
        <Metric label="Available" value={formatCents(Math.max(0, metrics.availableCents))} />
        <Metric label="Orders margin" value={formatCents(metrics.ordersMarginCents)} />
        <Metric
          label="Margin buffer"
          value={`${(metrics.marginBuffer * 100).toFixed(1)}%`}
          tone={metrics.marginBuffer < 0.2 ? -1 : 0}
        />
        <Metric label="Fees paid" value={formatCents(metrics.feesCents)} />

        <div className="summary-actions">
          <AccountSwitcher />
          <button className="icon-button" title="Reset this account" onClick={reset}>
            <RotateCcw size={14} />
          </button>
          <button
            className="icon-button"
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="panel-tabs slim">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === 'orders' && workingOrders.length > 0 && (
                  <span className="tab-count">{workingOrders.length}</span>
                )}
                {t.id === 'journal' && trips.length > 0 && (
                  <span className="tab-count">{trips.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="account-tab-body">
            {tab === 'positions' && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Avg entry</th>
                    <th>Mark</th>
                    <th>Notional</th>
                    <th>Margin</th>
                    <th>Liquidation</th>
                    <th>Unrealised</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {account.position.qty === 0 ? (
                    <tr>
                      <td className="empty" colSpan={10}>
                        No open position.
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td>DAVID/USD</td>
                      <td className={account.position.qty > 0 ? 'up' : 'down'}>
                        {account.position.qty > 0 ? 'Long' : 'Short'}
                      </td>
                      <td>{Math.abs(qtyToUnits(account.position.qty)).toFixed(4)}</td>
                      <td>{formatCents(metrics.averageEntryCents)}</td>
                      <td>{formatCents(quote.lastCents)}</td>
                      <td>{formatCents(metrics.positionNotionalCents)}</td>
                      <td>{formatCents(metrics.positionMarginCents)}</td>
                      <td className="down">
                        {metrics.liquidationCents === null
                          ? '—'
                          : formatCents(metrics.liquidationCents)}
                      </td>
                      <td className={metrics.unrealisedPnlCents >= 0 ? 'up' : 'down'}>
                        {formatSignedCents(metrics.unrealisedPnlCents)}
                      </td>
                      <td className="row-actions">
                        <button onClick={() => reversePosition(currentQuote())}>Reverse</button>
                        <button className="danger" onClick={() => closePosition(currentQuote())}>
                          <X size={12} /> Close
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {tab === 'orders' && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Side</th>
                    <th>Type</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>
                      {workingOrders.length > 1 && (
                        <button className="link-button" onClick={cancelAll}>
                          Cancel all
                        </button>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {workingOrders.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={6}>
                        No working orders. Place a limit or stop order from the panel on the right,
                        or click a level on the DOM.
                      </td>
                    </tr>
                  ) : (
                    workingOrders.map((o) => (
                      <OrderRow key={o.id} order={o} onCancel={() => cancelOrder(o.id)} />
                    ))
                  )}
                </tbody>
              </table>
            )}

            {tab === 'history' && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Side</th>
                    <th>Type</th>
                    <th>Qty</th>
                    <th>Fill price</th>
                    <th>Fee</th>
                    <th>Realised</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={8}>
                        No orders yet. Use the panel on the right to buy or sell.
                      </td>
                    </tr>
                  ) : (
                    history.map((o) => (
                      <HistoryRow
                        key={o.id}
                        order={o}
                        execution={account.executions.find((x) => x.orderId === o.id)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            )}
            {tab === 'journal' && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Opened</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Gross</th>
                    <th>Fees</th>
                    <th>Net</th>
                    <th>Held</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={10}>
                        No completed round trips yet. A trip is recorded once a position returns to
                        flat.
                      </td>
                    </tr>
                  ) : (
                    [...trips].reverse().map((trip) => (
                      <JournalRow
                        key={trip.id}
                        trip={trip}
                        note={account.notes[trip.id] ?? ''}
                        onNote={(note) => setNote(trip.id, note)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            )}

            {tab === 'stats' && (
              <div className="stats-pane">
                <div className="stats-grid">
                  <Stat label="Trades" value={String(stats.trips)} />
                  <Stat
                    label="Win rate"
                    value={stats.trips === 0 ? '—' : formatPercent(stats.winRate, 1).replace('+', '')}
                    tone={stats.winRate >= 0.5 ? 1 : -1}
                  />
                  <Stat label="Wins / losses" value={`${stats.wins} / ${stats.losses}`} />
                  <Stat label="Average win" value={formatSignedCents(stats.avgWinCents)} tone={1} />
                  <Stat label="Average loss" value={formatSignedCents(stats.avgLossCents)} tone={-1} />
                  <Stat
                    label="Profit factor"
                    value={
                      stats.trips === 0
                        ? '—'
                        : stats.profitFactor === Number.POSITIVE_INFINITY
                          ? '∞'
                          : stats.profitFactor.toFixed(2)
                    }
                    tone={stats.profitFactor >= 1 ? 1 : -1}
                  />
                  <Stat
                    label="Expectancy"
                    value={formatSignedCents(stats.expectancyCents)}
                    tone={stats.expectancyCents}
                  />
                  <Stat label="Largest win" value={formatSignedCents(stats.largestWinCents)} tone={1} />
                  <Stat
                    label="Largest loss"
                    value={formatSignedCents(stats.largestLossCents)}
                    tone={-1}
                  />
                  <Stat label="Max drawdown" value={formatCents(stats.maxDrawdownCents)} tone={-1} />
                  <Stat label="Best streak" value={`${stats.bestStreak} wins`} tone={1} />
                  <Stat label="Worst streak" value={`${stats.worstStreak} losses`} tone={-1} />
                  <Stat label="Fees paid" value={formatCents(stats.feesCents)} />
                  <Stat
                    label="Net result"
                    value={formatSignedCents(stats.netCents)}
                    tone={stats.netCents}
                  />
                </div>
                <div className="stats-chart">
                  <div className="stats-chart-title">Equity curve</div>
                  <EquityCurve points={curve} />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone = 0 }: { label: string; value: string; tone?: number }): JSX.Element {
  const cls = tone > 0 ? 'up' : tone < 0 ? 'down' : '';
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${cls}`}>{value}</span>
    </div>
  );
}

function JournalRow({
  trip,
  note,
  onNote,
}: {
  trip: Trip;
  note: string;
  onNote: (note: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(note);
  return (
    <tr className={trip.liquidated ? 'system-row' : ''}>
      <td>{new Date(trip.openedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' })}</td>
      <td className={trip.direction === 'long' ? 'up' : 'down'}>
        {trip.direction === 'long' ? 'Long' : 'Short'}
        {trip.liquidated ? ' (liq)' : ''}
      </td>
      <td>{tripUnits(trip).toFixed(4)}</td>
      <td>{formatCents(trip.avgEntryCents)}</td>
      <td>{formatCents(trip.avgExitCents)}</td>
      <td className={trip.grossCents >= 0 ? 'up' : 'down'}>{formatSignedCents(trip.grossCents)}</td>
      <td>{formatCents(trip.feesCents)}</td>
      <td className={trip.netCents >= 0 ? 'up' : 'down'}>{formatSignedCents(trip.netCents)}</td>
      <td>{formatDuration(trip.durationMs)}</td>
      <td className="note-cell">
        <input
          value={draft}
          placeholder="Add a note"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onNote(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </td>
    </tr>
  );
}

function Metric({
  label,
  value,
  tone = 0,
}: {
  label: string;
  value: string;
  tone?: number;
}): JSX.Element {
  const cls = tone > 0 ? 'up' : tone < 0 ? 'down' : '';
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-value ${cls}`}>{value}</span>
    </div>
  );
}

function OrderRow({ order, onCancel }: { order: Order; onCancel: () => void }): JSX.Element {
  const price = order.limitCents ?? order.stopCents;
  return (
    <tr>
      <td>{new Date(order.createdAt).toLocaleTimeString('en-GB')}</td>
      <td className={order.side === 'buy' ? 'up' : 'down'}>{order.side === 'buy' ? 'Buy' : 'Sell'}</td>
      <td>
        {order.tag === 'tp' ? 'take profit' : order.tag === 'sl' ? 'stop loss' : order.type}
        {order.triggered ? ' (triggered)' : ''}
      </td>
      <td>{qtyToUnits(order.qty).toFixed(4)}</td>
      <td>{price ? formatCents(price) : '—'}</td>
      <td className="row-actions">
        <button className="danger" onClick={onCancel}>
          <Trash2 size={11} /> Cancel
        </button>
      </td>
    </tr>
  );
}

function HistoryRow({
  order,
  execution,
}: {
  order: Order;
  execution: Execution | undefined;
}): JSX.Element {
  const realised = execution?.realisedCents ?? 0;
  return (
    <tr className={order.system ? 'system-row' : ''}>
      <td>{new Date(order.filledAt ?? order.createdAt).toLocaleTimeString('en-GB')}</td>
      <td className={order.side === 'buy' ? 'up' : 'down'}>{order.side === 'buy' ? 'Buy' : 'Sell'}</td>
      <td>{order.system ? 'liquidation' : order.type}</td>
      <td>{qtyToUnits(order.qty).toFixed(4)}</td>
      <td>{order.fillPriceCents ? formatCents(order.fillPriceCents) : '—'}</td>
      <td>{order.feeCents ? formatCents(order.feeCents) : '—'}</td>
      <td className={realised > 0 ? 'up' : realised < 0 ? 'down' : ''}>
        {execution ? formatSignedCents(realised) : '—'}
      </td>
      <td className="status">{order.status}</td>
    </tr>
  );
}

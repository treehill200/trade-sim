import { formatCents, formatSignedCents } from '@/chart/format';
import { qtyToUnits, type Cents } from './money';
import type { AccountMetrics } from './metrics';
import type { Account, Order } from './types';

export type LineKind = 'entry' | 'liquidation' | 'order' | 'tp' | 'sl' | 'alert';
export type LineTone = 'up' | 'down' | 'accent' | 'muted' | 'warn';

/**
 * A horizontal line the chart draws for the account.
 *
 * Computed from the account rather than stored, so the chart can never show a
 * position or an order that does not exist.
 */
export interface ChartLine {
  id: string;
  kind: LineKind;
  priceCents: Cents;
  /** Text drawn at the left end of the line. */
  label: string;
  tone: LineTone;
  /** Working order this line represents, when there is one. */
  orderId?: string;
  /** Price alert this line represents, when there is one. */
  alertId?: string;
  /** Only working orders can be dragged to a new price. */
  draggable: boolean;
}

function orderLabel(order: Order): string {
  const size = qtyToUnits(order.qty).toFixed(4);
  if (order.tag === 'tp') return `TP ${size}`;
  if (order.tag === 'sl') return `SL ${size}`;
  const type = order.type === 'stopLimit' ? 'stop-limit' : order.type;
  return `${order.side === 'buy' ? 'Buy' : 'Sell'} ${type} ${size}`;
}

function orderPrice(order: Order): Cents | null {
  // A stop-limit is drawn at its trigger: that is the price the user watches.
  if (order.type === 'limit') return order.limitCents ?? null;
  return order.stopCents ?? order.limitCents ?? null;
}

export function chartLines(account: Account, metrics: AccountMetrics): ChartLine[] {
  const lines: ChartLine[] = [];
  const { position } = account;

  if (position.qty !== 0) {
    const units = Math.abs(qtyToUnits(position.qty)).toFixed(4);
    const direction = position.qty > 0 ? 'Long' : 'Short';
    lines.push({
      id: 'entry',
      kind: 'entry',
      priceCents: metrics.averageEntryCents,
      label: `${direction} ${units}   ${formatSignedCents(metrics.unrealisedPnlCents)}`,
      tone: metrics.unrealisedPnlCents >= 0 ? 'up' : 'down',
      draggable: false,
    });
    if (metrics.liquidationCents !== null && metrics.liquidationCents > 0) {
      lines.push({
        id: 'liquidation',
        kind: 'liquidation',
        priceCents: metrics.liquidationCents,
        label: `Liquidation ${formatCents(metrics.liquidationCents)}`,
        tone: 'down',
        draggable: false,
      });
    }
  }

  for (const order of account.orders) {
    if (order.status !== 'working') continue;
    const price = orderPrice(order);
    if (price === null) continue;
    lines.push({
      id: order.id,
      kind: order.tag === 'tp' ? 'tp' : order.tag === 'sl' ? 'sl' : 'order',
      priceCents: price,
      label: orderLabel(order),
      tone: order.tag === 'tp' ? 'up' : order.tag === 'sl' ? 'down' : 'accent',
      orderId: order.id,
      draggable: true,
    });
  }

  return lines;
}

/** Lines for the armed price alerts, drawn alongside the account's own. */
export function alertChartLines(
  alerts: { id: string; priceCents: Cents; direction: 'above' | 'below'; armed: boolean }[],
): ChartLine[] {
  return alerts
    .filter((a) => a.armed)
    .map((a) => ({
      id: `alert-${a.id}`,
      kind: 'alert' as const,
      priceCents: a.priceCents,
      label: `Alert ${a.direction === 'above' ? '↑' : '↓'} ${formatCents(a.priceCents)}`,
      tone: 'warn' as const,
      alertId: a.id,
      draggable: true,
    }));
}

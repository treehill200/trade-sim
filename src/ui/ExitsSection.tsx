import { centsToDollars, dollarsToCents, QTY_SCALE, type Cents, type Qty } from '@/trading/money';
import { formatCents } from '@/chart/format';

export type ExitMode = 'price' | 'ticks' | 'percent' | 'usd';

const MODES: { id: ExitMode; label: string }[] = [
  { id: 'price', label: 'Price' },
  { id: 'ticks', label: 'Ticks' },
  { id: 'percent', label: '%' },
  { id: 'usd', label: 'USD' },
];

export interface ExitState {
  enabled: boolean;
  mode: ExitMode;
  value: string;
}

export const DEFAULT_TAKE_PROFIT: ExitState = { enabled: false, mode: 'percent', value: '2' };
export const DEFAULT_STOP_LOSS: ExitState = { enabled: false, mode: 'percent', value: '1' };

/**
 * Turn an exit expressed in any unit into a price.
 *
 * `favourable` is true for a take-profit, which sits on the profitable side of
 * the entry, and false for a stop-loss. Everything is derived from the entry
 * price so the four units describe the same thing four ways.
 */
export function exitPrice(
  exit: ExitState,
  entryCents: Cents,
  qty: Qty,
  long: boolean,
  favourable: boolean,
): Cents | undefined {
  if (!exit.enabled) return undefined;
  const value = Number(exit.value);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  // A take-profit is above the entry for a long and below it for a short; a
  // stop-loss is the other way round.
  const up = favourable === long;

  let offset: number;
  if (exit.mode === 'price') {
    const price = dollarsToCents(value);
    return price > 0 ? price : undefined;
  }
  if (exit.mode === 'ticks') offset = Math.round(value);
  else if (exit.mode === 'percent') offset = Math.round((entryCents * value) / 100);
  else {
    // A dollar amount of profit or loss, converted through the position size.
    if (qty <= 0) return undefined;
    offset = Math.round((dollarsToCents(value) * QTY_SCALE) / qty);
  }
  const price = up ? entryCents + offset : entryCents - offset;
  return price > 0 ? price : undefined;
}

export function ExitRow({
  label,
  exit,
  onChange,
  resolvedCents,
  tone,
}: {
  label: string;
  exit: ExitState;
  onChange: (next: ExitState) => void;
  resolvedCents: Cents | undefined;
  tone: 'up' | 'down';
}): JSX.Element {
  return (
    <div className="exit-row">
      <label className="exit-head">
        <input
          type="checkbox"
          checked={exit.enabled}
          onChange={(e) => onChange({ ...exit, enabled: e.target.checked })}
        />
        <span>{label}</span>
        {exit.enabled && resolvedCents !== undefined && (
          <span className={`exit-resolved ${tone}`}>{formatCents(resolvedCents)}</span>
        )}
      </label>
      {exit.enabled && (
        <div className="field-row">
          <input
            inputMode="decimal"
            value={exit.value}
            aria-label={`${label} value`}
            onChange={(e) => onChange({ ...exit, value: e.target.value })}
          />
          <div className="segmented small">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={exit.mode === m.id ? 'active' : ''}
                onClick={() => {
                  // Carry the current price across when switching to absolute
                  // mode, so the value stays meaningful.
                  const next =
                    m.id === 'price' && resolvedCents !== undefined
                      ? centsToDollars(resolvedCents).toFixed(2)
                      : exit.value;
                  onChange({ ...exit, mode: m.id, value: next });
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useTrading } from '@/state/tradingStore';
import { centsToDollars, dollarsToCents, percentToPpm, ppmToPercent } from '@/trading/money';
import { MAX_LEVERAGE, MIN_LEVERAGE } from '@/trading/types';

/** Starting balance, leverage, commissions and the two realism switches. */
export function AccountSettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const account = useTrading((s) => s.active());
  const updateSettings = useTrading((s) => s.updateSettings);
  const reset = useTrading((s) => s.reset);
  const [confirmReset, setConfirmReset] = useState(false);

  const s = account.settings;
  const [balance, setBalance] = useState(centsToDollars(s.startingBalanceCents).toString());
  const [leverage, setLeverage] = useState(String(s.leverage));
  const [maker, setMaker] = useState(ppmToPercent(s.makerFeePpm).toString());
  const [taker, setTaker] = useState(ppmToPercent(s.takerFeePpm).toString());
  const [maintenance, setMaintenance] = useState(ppmToPercent(s.maintenanceMarginPpm).toString());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** The starting balance can only be changed on an untouched account. */
  const balanceLocked = account.executions.length > 0 || account.position.qty !== 0;

  const commit = (): void => {
    const patch: Parameters<typeof updateSettings>[0] = {};
    const lev = Number(leverage);
    if (Number.isFinite(lev)) patch.leverage = lev;
    const mk = Number(maker);
    if (Number.isFinite(mk) && mk >= 0) patch.makerFeePpm = percentToPpm(mk);
    const tk = Number(taker);
    if (Number.isFinite(tk) && tk >= 0) patch.takerFeePpm = percentToPpm(tk);
    const mm = Number(maintenance);
    if (Number.isFinite(mm) && mm > 0) patch.maintenanceMarginPpm = percentToPpm(mm);
    if (!balanceLocked) {
      const bal = Number(balance);
      if (Number.isFinite(bal) && bal > 0) patch.startingBalanceCents = dollarsToCents(bal);
    }
    updateSettings(patch);
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal modal-narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Account settings</h2>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <label className="settings-row">
            <span>Starting balance (USD)</span>
            <input
              type="number"
              min={1}
              step={100}
              value={balance}
              disabled={balanceLocked}
              onChange={(e) => setBalance(e.target.value)}
            />
          </label>
          {balanceLocked && (
            <div className="settings-note">
              Reset the account to change its starting balance.
            </div>
          )}

          <label className="settings-row">
            <span>Leverage ({MIN_LEVERAGE}x–{MAX_LEVERAGE}x)</span>
            <input
              type="number"
              min={MIN_LEVERAGE}
              max={MAX_LEVERAGE}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
            />
          </label>
          <input
            className="settings-slider"
            type="range"
            min={MIN_LEVERAGE}
            max={MAX_LEVERAGE}
            step={1}
            value={Number(leverage) || 1}
            onChange={(e) => setLeverage(e.target.value)}
            aria-label="Leverage"
          />

          <h3 className="modal-group">Costs</h3>
          <label className="settings-row">
            <span>Maker commission (%)</span>
            <input type="number" min={0} step={0.001} value={maker} onChange={(e) => setMaker(e.target.value)} />
          </label>
          <label className="settings-row">
            <span>Taker commission (%)</span>
            <input type="number" min={0} step={0.001} value={taker} onChange={(e) => setTaker(e.target.value)} />
          </label>
          <label className="settings-row">
            <span>Maintenance margin (%)</span>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={maintenance}
              onChange={(e) => setMaintenance(e.target.value)}
            />
          </label>

          <h3 className="modal-group">Realism</h3>
          <label className="settings-row">
            <span>Slippage on market orders</span>
            <input
              type="checkbox"
              checked={s.slippage}
              onChange={(e) => updateSettings({ slippage: e.target.checked })}
            />
          </label>
          <label className="settings-row">
            <span>Trade against the bid/ask spread</span>
            <input
              type="checkbox"
              checked={s.spread}
              onChange={(e) => updateSettings({ spread: e.target.checked })}
            />
          </label>
        </div>
        <div className="modal-footer">
          {confirmReset ? (
            <span className="confirm-inline">
              Reset to {centsToDollars(s.startingBalanceCents).toLocaleString('en-US')} and clear history?
              <button className="text-button danger" onClick={() => { reset(); setConfirmReset(false); onClose(); }}>
                Yes, reset
              </button>
              <button className="text-button" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="text-button danger" onClick={() => setConfirmReset(true)}>
              Reset account
            </button>
          )}
          <button className="primary-button" onClick={commit}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

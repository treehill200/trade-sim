import { useEffect, useState } from 'react';
import { Bell, RotateCcw, Trash2, Volume2, X } from 'lucide-react';
import { formatCents } from '@/chart/format';
import { marketClient } from '@/state/marketClient';
import { playAlertTone, playFillTone, speak, useAlerts } from '@/state/alertsStore';
import { centsToDollars, dollarsToCents } from '@/trading/money';

/** Price alerts, plus the sound and announcement preferences. */
export function AlertsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const alerts = useAlerts((s) => s.alerts);
  const add = useAlerts((s) => s.add);
  const remove = useAlerts((s) => s.remove);
  const rearm = useAlerts((s) => s.rearm);
  const clearTriggered = useAlerts((s) => s.clearTriggered);
  const sound = useAlerts((s) => s.sound);
  const toggleSound = useAlerts((s) => s.toggleSound);
  const fillSound = useAlerts((s) => s.fillSound);
  const toggleFillSound = useAlerts((s) => s.toggleFillSound);
  const announceFills = useAlerts((s) => s.announceFills);
  const toggleAnnounceFills = useAlerts((s) => s.toggleAnnounceFills);

  const last = marketClient.quote.last || marketClient.series.lastClose() || 0;
  const [priceText, setPriceText] = useState(() => centsToDollars(last).toFixed(2));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = (): void => {
    const cents = dollarsToCents(Number(priceText));
    if (!Number.isFinite(cents) || cents <= 0) return;
    // The direction is implied: an alert above the market fires on the way up.
    add(cents, cents >= last ? 'above' : 'below');
  };

  const triggered = alerts.filter((a) => !a.armed).length;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal modal-narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Price alerts</h2>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="alert-add">
            <input
              inputMode="decimal"
              value={priceText}
              aria-label="Alert price"
              onChange={(e) => setPriceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
            <button className="primary-button" onClick={submit}>
              Add alert
            </button>
          </div>
          <div className="settings-note">
            An alert above the current price of {formatCents(last)} fires on the way up, and one
            below it fires on the way down. You can also press Alt+A to drop one at the crosshair,
            then drag its line to move it.
          </div>

          {alerts.length === 0 ? (
            <p className="modal-empty">No alerts yet.</p>
          ) : (
            <div className="alert-list">
              {alerts.map((alert) => (
                <div key={alert.id} className={`alert-row ${alert.armed ? '' : 'fired'}`}>
                  <Bell size={14} />
                  <span className="alert-price">{formatCents(alert.priceCents)}</span>
                  <span className="alert-dir">
                    {alert.direction === 'above' ? 'crosses up' : 'crosses down'}
                  </span>
                  <span className="alert-state">
                    {alert.armed
                      ? 'armed'
                      : `fired ${new Date(alert.triggeredAt ?? Date.now()).toLocaleTimeString('en-GB')}`}
                  </span>
                  {!alert.armed && (
                    <button title="Arm it again" onClick={() => rearm(alert.id)}>
                      <RotateCcw size={12} />
                    </button>
                  )}
                  <button className="danger" title="Delete" onClick={() => remove(alert.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <h3 className="modal-group">Sound</h3>
          <label className="settings-row">
            <span>Chime when an alert fires</span>
            <input type="checkbox" checked={sound} onChange={toggleSound} />
          </label>
          <label className="settings-row">
            <span>Tone when an order fills</span>
            <input type="checkbox" checked={fillSound} onChange={toggleFillSound} />
          </label>
          <label className="settings-row">
            <span>Say &ldquo;order filled&rdquo; out loud</span>
            <input type="checkbox" checked={announceFills} onChange={toggleAnnounceFills} />
          </label>
          <div className="alert-test">
            <button className="text-button" onClick={() => playAlertTone()}>
              <Volume2 size={13} /> Test alert chime
            </button>
            <button className="text-button" onClick={() => playFillTone(true)}>
              <Volume2 size={13} /> Test fill tone
            </button>
            <button className="text-button" onClick={() => speak('Order filled')}>
              <Volume2 size={13} /> Test voice
            </button>
          </div>
        </div>

        <div className="modal-footer">
          {triggered > 0 ? (
            <button className="text-button" onClick={clearTriggered}>
              Clear {triggered} fired
            </button>
          ) : (
            <span />
          )}
          <button className="primary-button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

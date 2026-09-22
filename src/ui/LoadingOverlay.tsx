import { RotateCcw, Trash2 } from 'lucide-react';
import type { MarketStatus } from '@/state/marketClient';
import { startOver } from './recover';

const PHASE_TEXT: Record<string, string> = {
  idle: 'Starting up',
  loading: 'Opening saved market history',
  backfill: 'Generating 30 days of David Coin history',
  catchup: 'Filling in prices from while you were away',
  error: 'Something went wrong',
};

export function LoadingOverlay({ status }: { status: MarketStatus }): JSX.Element | null {
  if (status.phase === 'ready') return null;
  const pct = status.total > 0 ? Math.min(100, (status.done / status.total) * 100) : 0;
  const isError = status.phase === 'error';

  return (
    <div className="loading-overlay">
      <div className="loading-card">
        <div className="loading-title">{PHASE_TEXT[status.phase] ?? 'Loading'}</div>
        {isError ? (
          <>
            <div className="loading-error">{status.message ?? 'Unknown error'}</div>
            <p className="loading-help">
              The market could not be started. Reloading usually fixes it; clearing the saved
              data starts a brand new market from scratch.
            </p>
            <div className="crash-actions">
              <button className="primary-button" onClick={() => window.location.reload()}>
                <RotateCcw size={14} /> Reload the page
              </button>
              <button className="text-button danger" onClick={() => void startOver()}>
                <Trash2 size={13} /> Clear saved data and start over
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="loading-track">
              <div className="loading-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="loading-sub">{pct.toFixed(0)}%</div>
          </>
        )}
      </div>
    </div>
  );
}

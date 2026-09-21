import type { MarketStatus } from '@/state/marketClient';

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
          <div className="loading-error">{status.message ?? 'Unknown error'}</div>
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

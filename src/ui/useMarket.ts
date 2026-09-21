import { useEffect, useState } from 'react';
import { marketClient, type MarketStatus } from '@/state/marketClient';

/**
 * Re-render at most `hz` times per second while the market is ticking.
 *
 * Prices update several times a second; letting React re-render on every one
 * of them would be wasteful, so components that display numbers opt into a
 * throttled pulse instead.
 */
export function useMarketPulse(hz = 5): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    let last = 0;
    const minGap = 1000 / hz;
    return marketClient.onData(() => {
      const now = performance.now();
      if (now - last < minGap) return;
      last = now;
      setTick((n) => n + 1);
    });
  }, [hz]);
  return 0;
}

export function useMarketStatus(): MarketStatus {
  const [status, setStatus] = useState<MarketStatus>(marketClient.status);
  useEffect(() => marketClient.onStatus(setStatus), []);
  return status;
}

/** A clock that re-renders once per second. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

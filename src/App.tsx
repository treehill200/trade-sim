import { useEffect } from 'react';
import { ChartCanvas } from '@/chart/ChartCanvas';
import { TopToolbar } from '@/ui/TopToolbar';
import { BottomBar } from '@/ui/BottomBar';
import { LoadingOverlay } from '@/ui/LoadingOverlay';
import { marketClient } from '@/state/marketClient';
import { useUi } from '@/state/store';
import { useMarketStatus } from '@/ui/useMarket';

export function App(): JSX.Element {
  const timeframe = useUi((s) => s.timeframe);
  const theme = useUi((s) => s.theme);
  const status = useMarketStatus();

  useEffect(() => {
    marketClient.start(useUi.getState().timeframe);
  }, []);

  useEffect(() => {
    marketClient.setTimeframe(timeframe);
  }, [timeframe]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Give the worker a chance to checkpoint before the tab goes away.
  useEffect(() => {
    const flush = () => marketClient.flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  return (
    <div className="app">
      <TopToolbar />
      <main className="workspace">
        <ChartCanvas />
      </main>
      <BottomBar />
      <LoadingOverlay status={status} />
    </div>
  );
}

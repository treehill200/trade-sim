import { useEffect } from 'react';
import { ChartCanvas } from '@/chart/ChartCanvas';
import { DrawingToolbar } from '@/ui/DrawingToolbar';
import { OrderPanel } from '@/ui/OrderPanel';
import { AccountPanel } from '@/ui/AccountPanel';
import { Toasts } from '@/ui/Toasts';
import { useMarkToMarket } from '@/ui/useQuote';
import { TopToolbar } from '@/ui/TopToolbar';
import { BottomBar } from '@/ui/BottomBar';
import { LoadingOverlay } from '@/ui/LoadingOverlay';
import { marketClient } from '@/state/marketClient';
import { useUi } from '@/state/store';
import { useMarketStatus } from '@/ui/useMarket';
import {
  IndicatorSettingsProvider,
  useIndicatorSettings,
} from '@/ui/IndicatorSettingsContext';
import { IndicatorSettingsDialog } from '@/ui/IndicatorSettingsDialog';

export function App(): JSX.Element {
  const timeframe = useUi((s) => s.timeframe);
  const theme = useUi((s) => s.theme);
  const status = useMarketStatus();
  useMarkToMarket();

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
    <IndicatorSettingsProvider>
      <div className="app">
        <TopToolbar />
        <main className="workspace">
          <DrawingToolbar />
          <div className="chart-column">
            <div className="chart-area">
              <ChartCanvas />
            </div>
            <AccountPanel />
          </div>
          <OrderPanel />
        </main>
        <BottomBar />
        <LoadingOverlay status={status} />
        <SettingsDialogHost />
        <Toasts />
      </div>
    </IndicatorSettingsProvider>
  );
}

/** Renders whichever indicator settings dialog the legend gear buttons opened. */
function SettingsDialogHost(): JSX.Element | null {
  const { openId, close } = useIndicatorSettings();
  if (!openId) return null;
  return <IndicatorSettingsDialog instanceId={openId} onClose={close} />;
}

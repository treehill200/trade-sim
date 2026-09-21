import {
  BarChart3,
  Camera,
  CandlestickChart,
  LineChart,
  Maximize2,
  Minimize2,
  Moon,
  Ruler,
  Scaling,
  Sun,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChartTypeMenu } from './ChartTypeMenu';
import { IndicatorsDialog } from './IndicatorsDialog';
import { CursorMenu } from './CursorMenu';
import { chartController } from '@/chart/chartController';
import { TIMEFRAMES, type Timeframe } from '@/engine/timeframes';
import { useUi } from '@/state/store';
import { marketClient } from '@/state/marketClient';
import { formatCents, formatPercent } from '@/chart/format';
import { useMarketPulse } from './useMarket';

/** Quick-access timeframes get their own buttons; the rest live in the select. */
const QUICK: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1D'];

export function TopToolbar(): JSX.Element {
  useMarketPulse(4);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const {
    timeframe,
    setTimeframe,
    theme,
    setTheme,
    autoScale,
    toggleAutoScale,
    logScale,
    toggleLogScale,
    showVolume,
    toggleVolume,
  } = useUi();

  const series = marketClient.series;
  const last = marketClient.quote.last || series.lastClose();
  // Rolling 24-hour change, the number a crypto trader expects in a header.
  const dayAgo = series.indexAtOrBefore(Date.now() - 24 * 60 * 60 * 1000);
  const reference =
    series.length === 0 ? last : (series.open[dayAgo >= 0 ? dayAgo : 0] as number);
  const dayChange = last - reference;
  const dayPct = reference > 0 ? dayChange / reference : 0;
  const cls = dayChange >= 0 ? 'up' : 'down';

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <div className="brand">
          <CandlestickChart size={18} strokeWidth={2.2} />
          <span>Trading Sim</span>
        </div>
        <div className="symbol-badge">
          <span className="symbol-ticker">DAVID/USD</span>
          <span className="symbol-name">David Coin</span>
        </div>
        <div className={`symbol-price ${cls}`}>
          <strong>{Number.isFinite(last) ? formatCents(last) : '—'}</strong>
          <span title="Change over the last 24 hours">{formatPercent(dayPct)}</span>
        </div>
      </div>

      <div className="toolbar-center">
        {QUICK.map((tf) => (
          <button
            key={tf}
            className={`tf-button ${tf === timeframe ? 'active' : ''}`}
            onClick={() => setTimeframe(tf)}
          >
            {tf}
          </button>
        ))}
        <select
          className="tf-select"
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value as Timeframe)}
          aria-label="Timeframe"
        >
          {TIMEFRAMES.map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
        <span className="toolbar-divider" />
        <ChartTypeMenu />
        <CursorMenu />
        <span className="toolbar-divider" />
        <button className="text-toolbar-button" onClick={() => setIndicatorsOpen(true)}>
          <LineChart size={15} />
          Indicators
        </button>
      </div>

      <div className="toolbar-right">
        <button
          className={`icon-button ${showVolume ? 'active' : ''}`}
          onClick={toggleVolume}
          title="Toggle volume"
        >
          <BarChart3 size={16} />
        </button>
        <button
          className={`icon-button ${autoScale ? 'active' : ''}`}
          onClick={toggleAutoScale}
          title="Auto scale price axis"
        >
          <Scaling size={16} />
        </button>
        <button
          className={`icon-button ${logScale ? 'active' : ''}`}
          onClick={toggleLogScale}
          title="Logarithmic price axis"
        >
          <Ruler size={16} />
        </button>
        <span className="toolbar-divider" />
        <button
          className="icon-button"
          onClick={() => chartController.current?.screenshot()}
          title="Save a PNG of the chart"
        >
          <Camera size={16} />
        </button>
        <button
          className="icon-button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          className="icon-button"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen().catch(() => undefined);
          }}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
      {indicatorsOpen && <IndicatorsDialog onClose={() => setIndicatorsOpen(false)} />}
    </header>
  );
}

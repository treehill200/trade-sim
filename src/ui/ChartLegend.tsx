import { marketClient } from '@/state/marketClient';
import { useUi } from '@/state/store';
import { formatCents, formatPercent, formatSignedCents, formatVolume } from '@/chart/format';
import { useMarketPulse } from './useMarket';

interface Props {
  /** Candle under the cursor, or null to describe the newest candle. */
  hoverIndex: number | null;
}

/**
 * OHLC readout in the chart's top-left corner.
 *
 * Rendered as HTML rather than into the canvas so the type stays crisp at any
 * device pixel ratio and can use the app's font stack directly.
 */
export function ChartLegend({ hoverIndex }: Props): JSX.Element | null {
  useMarketPulse(8);
  const timeframe = useUi((s) => s.timeframe);
  const series = marketClient.series;
  if (series.length === 0) return null;

  const i = hoverIndex ?? series.length - 1;
  const c = series.at(i);
  if (!c) return null;

  const change = c.close - c.open;
  const pct = c.open > 0 ? change / c.open : 0;
  const cls = change >= 0 ? 'up' : 'down';

  return (
    <div className="chart-legend">
      <div className="legend-title">
        <span className="legend-symbol">DAVID / USD</span>
        <span className="legend-tf">{timeframe}</span>
        <span className="legend-venue">David Coin · simulated</span>
      </div>
      <div className="legend-ohlc">
        <span className="legend-pair">
          <em>O</em>
          <b className={cls}>{formatCents(c.open)}</b>
        </span>
        <span className="legend-pair">
          <em>H</em>
          <b className={cls}>{formatCents(c.high)}</b>
        </span>
        <span className="legend-pair">
          <em>L</em>
          <b className={cls}>{formatCents(c.low)}</b>
        </span>
        <span className="legend-pair">
          <em>C</em>
          <b className={cls}>{formatCents(c.close)}</b>
        </span>
        <span className={`legend-change ${cls}`}>
          {formatSignedCents(change)} ({formatPercent(pct)})
        </span>
      </div>
      <div className="legend-volume">
        <em>Vol</em>
        <b className={cls}>{formatVolume(c.volume)}</b>
      </div>
    </div>
  );
}

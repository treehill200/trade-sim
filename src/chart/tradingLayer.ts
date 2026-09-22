import type { CandleSeries } from '@/engine/series';
import type { ChartTheme } from './theme';
import type { PriceScale, TimeScale } from './scales';
import { crisp } from './geometry';
import { PRICE_AXIS_WIDTH } from './renderer';
import { formatCents } from './format';
import type { ChartLine, LineTone } from '@/trading/chartLines';
import type { Execution } from '@/trading/types';
import type { DrawingMap } from '@/drawings/mapping';

export interface TradingLayerInput {
  lines: ChartLine[];
  executions: Execution[];
  series: CandleSeries;
  map: DrawingMap;
  timeScale: TimeScale;
  priceScale: PriceScale;
  theme: ChartTheme;
  dpr: number;
  /** Space reserved at the right end of a line for its HTML controls. */
  controlsWidth: number;
}

/** How many of the most recent fills are marked on the chart. */
const MAX_MARKERS = 400;

function toneColor(tone: LineTone, theme: ChartTheme): string {
  if (tone === 'up') return theme.up;
  if (tone === 'down') return theme.down;
  if (tone === 'accent') return theme.accent;
  return theme.textMuted;
}

/** Order and position lines, their labels, and the axis tags that go with them. */
export function drawTradingLines(ctx: CanvasRenderingContext2D, input: TradingLayerInput): void {
  const { lines, priceScale: ps, timeScale: ts, theme, dpr } = input;
  if (lines.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, ps.top, ts.width + PRICE_AXIS_WIDTH, ps.height);
  ctx.clip();

  for (const line of lines) {
    const y = ps.yOfPrice(line.priceCents);
    if (y < ps.top - 2 || y > ps.top + ps.height + 2) continue;
    const color = toneColor(line.tone, theme);
    const cy = crisp(y, dpr);

    ctx.save();
    // A liquidation line is solid so it reads as a hard boundary; everything
    // else is dashed, the convention for an order that has not happened yet.
    ctx.setLineDash(line.kind === 'liquidation' ? [] : [5 / dpr, 4 / dpr]);
    ctx.strokeStyle = color;
    ctx.lineWidth = line.kind === 'entry' || line.kind === 'liquidation' ? 1.5 : 1;
    ctx.globalAlpha = line.kind === 'liquidation' ? 0.85 : 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(ts.width, cy);
    ctx.stroke();
    ctx.restore();

    // Label at the left, clear of the OHLC legend's column.
    ctx.save();
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    const textWidth = ctx.measureText(line.label).width;
    const boxWidth = textWidth + 14;
    const boxX = 8;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    roundRect(ctx, boxX, y - 9, boxWidth, 18, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(line.label, boxX + 7, y);
    ctx.restore();

    // Price tag on the axis, matching the line's colour.
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(ts.width + 1, y - 8, PRICE_AXIS_WIDTH - 1, 16);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 10.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatCents(line.priceCents), ts.width + PRICE_AXIS_WIDTH / 2, y, PRICE_AXIS_WIDTH - 6);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Arrows on the candles where fills happened.
 *
 * Buys sit under the candle pointing up and sells above it pointing down, so
 * a marker never hides the price action it refers to.
 */
export function drawExecutionMarkers(ctx: CanvasRenderingContext2D, input: TradingLayerInput): void {
  const { executions, map, timeScale: ts, priceScale: ps, theme, dpr } = input;
  if (executions.length === 0) return;

  const recent =
    executions.length > MAX_MARKERS ? executions.slice(executions.length - MAX_MARKERS) : executions;
  const size = Math.max(4, Math.min(7, ts.barSpacing * 0.42));
  const gap = size + 3;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, ps.top, ts.width, ps.height);
  ctx.clip();

  for (const execution of recent) {
    const x = map.xOfTime(execution.time);
    if (x < -size || x > ts.width + size) continue;
    const y = ps.yOfPrice(execution.priceCents);
    if (y < ps.top - 20 || y > ps.top + ps.height + 20) continue;
    const buy = execution.side === 'buy';
    const color = execution.system ? theme.down : buy ? theme.up : theme.down;
    const tipY = buy ? y + gap : y - gap;
    const baseY = buy ? tipY + size * 1.5 : tipY - size * 1.5;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(crisp(x, dpr), tipY);
    ctx.lineTo(crisp(x - size, dpr), baseY);
    ctx.lineTo(crisp(x + size, dpr), baseY);
    ctx.closePath();
    ctx.fill();

    // A liquidation is marked with a ring, so it stands out from a manual fill.
    if (execution.system) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, size + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

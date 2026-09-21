import type { PriceScale, TimeScale } from './scales';
import type { ChartTheme } from './theme';
import type { PlotSeries } from './plotSeries';
import type { ChartType } from './chartTypes';
import { crisp, visibleRange, type Columns, DENSE_SPACING } from './geometry';

export interface PlotInput {
  series: PlotSeries;
  timeScale: TimeScale;
  priceScale: PriceScale;
  theme: ChartTheme;
  chartType: ChartType;
  dpr: number;
  /** Pixel-column reduction, present only when candles are sub-pixel thin. */
  columns: Columns | null;
  /**
   * Eased closing price of the newest candle, in the plot's own units.
   *
   * Prints arrive four times a second but the chart draws at sixty frames a
   * second; easing the live candle's closing edge toward each new print is
   * what stops it from stepping. It converges well inside one print, so the
   * candle is only ever a few milliseconds behind the truth, and the OHLC
   * legend always shows the real values.
   */
  liveClose: number | null;
}

/** The close to draw for candle `i`, easing only the newest one. */
function closeAt(input: PlotInput, i: number): number {
  if (input.liveClose !== null && i === input.series.length - 1) return input.liveClose;
  return input.series.close[i] as number;
}

/** Draw the price series in whichever style is selected. */
export function drawPriceSeries(ctx: CanvasRenderingContext2D, input: PlotInput): void {
  const { series, chartType } = input;
  if (series.length === 0) return;

  switch (chartType) {
    case 'line':
      drawLine(ctx, input, false);
      break;
    case 'area':
      drawLine(ctx, input, true);
      break;
    case 'bars':
      drawBars(ctx, input);
      break;
    case 'hollow':
      drawCandles(ctx, input, true);
      break;
    default:
      drawCandles(ctx, input, false);
  }
}

// --- candle styles ---------------------------------------------------------

/**
 * Candlesticks, optionally hollow.
 *
 * Hollow candles take their colour from the move since the previous close —
 * the direction of the market — and leave the body unfilled when the candle
 * itself closed above its open. That combination says more per candle than a
 * plain filled body does.
 */
function drawCandles(ctx: CanvasRenderingContext2D, input: PlotInput, hollow: boolean): void {
  const { series, timeScale: ts, priceScale: ps, theme, dpr, columns } = input;
  const spacing = ts.barSpacing;

  const upWicks = new Path2D();
  const downWicks = new Path2D();

  if (columns || spacing < DENSE_SPACING) {
    drawDenseColumns(input, upWicks, downWicks);
    ctx.fillStyle = theme.upWick;
    ctx.fill(upWicks);
    ctx.fillStyle = theme.downWick;
    ctx.fill(downWicks);
    return;
  }

  // Hollow candles need four buckets: each direction colour, filled or not.
  const upSolid = new Path2D();
  const upOutline = new Path2D();
  const downSolid = new Path2D();
  const downOutline = new Path2D();

  const { from, to } = visibleRange(series, ts);
  const bodyWidth = Math.max(1, Math.floor(spacing * 0.72));
  const halfBody = bodyWidth / 2;
  const wickWidth = Math.max(1 / dpr, Math.min(2, spacing * 0.12));
  const minH = 1 / dpr;
  const strokeWidth = 1;

  for (let i = from; i <= to; i++) {
    const x = ts.xOfIndex(i);
    if (x < -spacing || x > ts.width + spacing) continue;
    const o = series.open[i] as number;
    const c = closeAt(input, i);
    const prevClose = i > 0 ? (series.close[i - 1] as number) : o;
    // Filled candles take their colour from the candle; hollow candles take
    // it from the move since the previous close, which is the market's
    // direction rather than the candle's.
    const up = hollow ? c >= prevClose : c >= o;

    const cx = crisp(x, dpr);
    // The eased close can briefly sit outside the recorded range, so the wick
    // stretches to cover it rather than letting the body poke out.
    const yHigh = ps.yOfPrice(Math.max(series.high[i] as number, c));
    const yLow = ps.yOfPrice(Math.min(series.low[i] as number, c));
    (up ? upWicks : downWicks).rect(cx - wickWidth / 2, yHigh, wickWidth, Math.max(minH, yLow - yHigh));

    const yOpen = ps.yOfPrice(o);
    const yClose = ps.yOfPrice(c);
    const top = Math.round(Math.min(yOpen, yClose) * dpr) / dpr;
    const height = Math.max(minH, Math.abs(yClose - yOpen));
    const left = crisp(x - halfBody, dpr);

    if (hollow && c >= o) {
      // Outline only. Inset by half the stroke so it occupies the same
      // footprint as a filled body of the same width.
      const inset = strokeWidth / 2;
      (up ? upOutline : downOutline).rect(
        left + inset,
        top + inset,
        Math.max(minH, bodyWidth - strokeWidth),
        Math.max(minH, height - strokeWidth),
      );
    } else {
      (up ? upSolid : downSolid).rect(left, top, bodyWidth, height);
    }
  }

  ctx.fillStyle = theme.upWick;
  ctx.fill(upWicks);
  ctx.fillStyle = theme.downWick;
  ctx.fill(downWicks);
  ctx.fillStyle = theme.upFill;
  ctx.fill(upSolid);
  ctx.fillStyle = theme.downFill;
  ctx.fill(downSolid);

  if (hollow) {
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = theme.up;
    ctx.stroke(upOutline);
    ctx.strokeStyle = theme.down;
    ctx.stroke(downOutline);
    ctx.restore();
  }
}

/** OHLC bars: a high-low stick with an open tick left and a close tick right. */
function drawBars(ctx: CanvasRenderingContext2D, input: PlotInput): void {
  const { series, timeScale: ts, priceScale: ps, theme, dpr, columns } = input;
  const spacing = ts.barSpacing;

  const up = new Path2D();
  const down = new Path2D();

  if (columns || spacing < DENSE_SPACING) {
    drawDenseColumns(input, up, down);
    ctx.fillStyle = theme.up;
    ctx.fill(up);
    ctx.fillStyle = theme.down;
    ctx.fill(down);
    return;
  }

  const { from, to } = visibleRange(series, ts);
  const lineWidth = Math.max(1, Math.min(2, Math.floor(spacing * 0.16)));
  const tick = Math.max(2, Math.floor(spacing * 0.34));
  const minH = 1 / dpr;

  for (let i = from; i <= to; i++) {
    const x = ts.xOfIndex(i);
    if (x < -spacing || x > ts.width + spacing) continue;
    const o = series.open[i] as number;
    const c = closeAt(input, i);
    const path = c >= o ? up : down;
    const cx = crisp(x, dpr);
    const yHigh = ps.yOfPrice(Math.max(series.high[i] as number, c));
    const yLow = ps.yOfPrice(Math.min(series.low[i] as number, c));
    path.rect(cx - lineWidth / 2, yHigh, lineWidth, Math.max(minH, yLow - yHigh));
    path.rect(cx - tick, crisp(ps.yOfPrice(o), dpr) - lineWidth / 2, tick, lineWidth);
    path.rect(cx, crisp(ps.yOfPrice(c), dpr) - lineWidth / 2, tick, lineWidth);
  }

  ctx.fillStyle = theme.up;
  ctx.fill(up);
  ctx.fillStyle = theme.down;
  ctx.fill(down);
}

/** Shared dense fallback: one high-low hairline per pixel column. */
function drawDenseColumns(input: PlotInput, upPath: Path2D, downPath: Path2D): void {
  const { series, timeScale: ts, priceScale: ps, dpr, columns } = input;
  const w = 1 / dpr;

  if (columns) {
    for (let i = 0; i < columns.count; i++) {
      const yHigh = ps.yOfPrice(columns.high[i] as number);
      const yLow = ps.yOfPrice(columns.low[i] as number);
      const path = (columns.close[i] as number) >= (columns.open[i] as number) ? upPath : downPath;
      path.rect(columns.x[i] as number, yHigh, w, Math.max(w, yLow - yHigh));
    }
    return;
  }

  // Between one pixel and one candle body, reduce on the fly.
  const { from, to } = visibleRange(series, ts);
  let colX = Number.NaN;
  let colHigh = Number.NEGATIVE_INFINITY;
  let colLow = Number.POSITIVE_INFINITY;
  let colOpen = 0;
  let colClose = 0;
  let colCount = 0;

  const flush = (): void => {
    if (colCount === 0) return;
    const yHigh = ps.yOfPrice(colHigh);
    const yLow = ps.yOfPrice(colLow);
    (colClose >= colOpen ? upPath : downPath).rect(colX, yHigh, w, Math.max(w, yLow - yHigh));
    colCount = 0;
    colHigh = Number.NEGATIVE_INFINITY;
    colLow = Number.POSITIVE_INFINITY;
  };

  for (let i = from; i <= to; i++) {
    const x = ts.xOfIndex(i);
    if (x < -1 || x > ts.width + 1) continue;
    const px = Math.round(x * dpr) / dpr;
    if (px !== colX) {
      flush();
      colX = px;
      colOpen = series.open[i] as number;
    }
    const h = series.high[i] as number;
    const l = series.low[i] as number;
    if (h > colHigh) colHigh = h;
    if (l < colLow) colLow = l;
    colClose = series.close[i] as number;
    colCount += 1;
  }
  flush();
}

// --- line and area ---------------------------------------------------------

/**
 * Close-price line, optionally with a gradient fill beneath it.
 *
 * The line is stepped through pixel columns rather than candles when zoomed
 * out, so the path never carries more points than the screen has pixels.
 */
function drawLine(ctx: CanvasRenderingContext2D, input: PlotInput, filled: boolean): void {
  const { series, timeScale: ts, priceScale: ps, theme, dpr, columns } = input;
  const path = new Path2D();
  let started = false;
  let firstX = 0;
  let lastX = 0;

  if (columns) {
    for (let i = 0; i < columns.count; i++) {
      const x = columns.x[i] as number;
      const y = ps.yOfPrice(columns.close[i] as number);
      if (!started) {
        path.moveTo(x, y);
        firstX = x;
        started = true;
      } else {
        path.lineTo(x, y);
      }
      lastX = x;
    }
  } else {
    const { from, to } = visibleRange(series, ts);
    let prevPx = Number.NaN;
    for (let i = from; i <= to; i++) {
      const x = ts.xOfIndex(i);
      if (x < -2 || x > ts.width + 2) continue;
      // Collapse points that would land on the same device pixel.
      const px = Math.round(x * dpr) / dpr;
      if (px === prevPx && i !== to) continue;
      prevPx = px;
      const y = ps.yOfPrice(closeAt(input, i));
      if (!started) {
        path.moveTo(x, y);
        firstX = x;
        started = true;
      } else {
        path.lineTo(x, y);
      }
      lastX = x;
    }
  }
  if (!started) return;

  if (filled) {
    const fill = new Path2D(path);
    fill.lineTo(lastX, ps.top + ps.height);
    fill.lineTo(firstX, ps.top + ps.height);
    fill.closePath();
    const gradient = ctx.createLinearGradient(0, ps.top, 0, ps.top + ps.height);
    gradient.addColorStop(0, theme.areaTop);
    gradient.addColorStop(1, theme.areaBottom);
    ctx.fillStyle = gradient;
    ctx.fill(fill);
  }

  ctx.save();
  if (columns && columns.count > 1) {
    // Densely packed: fill the band the line sweeps instead of stroking it,
    // one rectangle per column. Stroking thousands of segments costs several
    // times more for the same picture.
    const w = 1 / dpr;
    ctx.fillStyle = theme.lineColor;
    for (let i = 0; i < columns.count; i++) {
      const yA = ps.yOfPrice(columns.close[i] as number);
      const next =
        i + 1 < columns.count ? (columns.close[i + 1] as number) : (columns.close[i] as number);
      const yB = ps.yOfPrice(next);
      const top = Math.min(yA, yB);
      ctx.fillRect(columns.x[i] as number, top, w, Math.max(1.5, Math.abs(yB - yA)));
    }
  } else {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = theme.lineColor;
    ctx.stroke(path);
  }
  ctx.restore();
}

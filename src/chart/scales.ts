/**
 * The two axes, kept apart.
 *
 * Every pane on the chart shares one horizontal scale — that is what makes the
 * main chart and an RSI pane line up candle for candle — while each pane owns
 * its own vertical scale, because an RSI runs 0-100 and a price does not.
 *
 * Horizontal position is tracked in *bar index* space rather than time, which
 * makes panning feel identical at every timeframe and lets the chart scroll
 * past the newest candle into empty space on the right.
 */

export interface PriceRange {
  min: number;
  max: number;
}

export const MIN_BAR_SPACING = 0.015;
export const MAX_BAR_SPACING = 160;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Shared horizontal scale: bar index to x pixel. */
export class TimeScale {
  /** Width of the plot area in CSS pixels (excludes the price axis). */
  width = 0;
  /** Horizontal pixels per candle. */
  barSpacing = 8;
  /** Fractional bar index sitting at the right edge of the plot area. */
  rightIndex = 0;

  get barsVisible(): number {
    return this.width / this.barSpacing;
  }

  get leftIndex(): number {
    return this.rightIndex - this.barsVisible;
  }

  xOfIndex(i: number): number {
    return this.width - (this.rightIndex - i) * this.barSpacing;
  }

  indexOfX(x: number): number {
    return this.rightIndex - (this.width - x) / this.barSpacing;
  }

  /** Change zoom without moving the scroll position. */
  setBarSpacing(next: number): void {
    this.barSpacing = clamp(next, MIN_BAR_SPACING, MAX_BAR_SPACING);
  }

  /** Zoom around a pixel anchor, keeping the bar under the cursor in place. */
  zoomAt(x: number, factor: number): void {
    const anchorIndex = this.indexOfX(x);
    const next = clamp(this.barSpacing * factor, MIN_BAR_SPACING, MAX_BAR_SPACING);
    if (next === this.barSpacing) return;
    this.barSpacing = next;
    // Re-derive rightIndex so `anchorIndex` maps back to the same x.
    this.rightIndex = anchorIndex + (this.width - x) / this.barSpacing;
  }

  /** Most empty space allowed to the right of the newest candle, in pixels. */
  maxRightMarginPx(): number {
    return this.width * 0.4;
  }

  /**
   * Keep the scroll position sane.
   *
   * Without this, zooming out with the cursor away from the right edge walks
   * the newest candle off the screen and leaves the user staring at an empty
   * pane with no obvious way back.
   */
  clampScroll(seriesLength: number): void {
    if (seriesLength === 0) return;
    const last = seriesLength - 1;
    const maxRight = last + this.maxRightMarginPx() / this.barSpacing;
    // Never scroll so far left that no candle is left on screen.
    const minRight = Math.min(last, 10);
    this.rightIndex = clamp(this.rightIndex, minRight, maxRight);
  }
}

/** A pane's vertical scale. `yOfPrice` returns absolute canvas coordinates. */
export class PriceScale {
  /** Top edge of the pane in CSS pixels, measured from the canvas top. */
  top = 0;
  /** Height of the pane in CSS pixels. */
  height = 0;

  /** When true the range follows the visible data. */
  autoScale = true;
  /** When true values are laid out on a logarithmic axis. */
  logScale = false;

  /** Active range, recomputed each frame when auto-scaling. */
  range: PriceRange = { min: 0, max: 1 };

  /** Extra room above and below the visible extremes, as a fraction. */
  paddingTop = 0.12;
  paddingBottom = 0.12;

  /** When set, auto-scale never goes outside these bounds (RSI, Stochastic). */
  fixedRange: PriceRange | null = null;

  private t(value: number): number {
    return this.logScale ? Math.log(Math.max(value, 1e-9)) : value;
  }

  private tInv(v: number): number {
    return this.logScale ? Math.exp(v) : v;
  }

  yOfPrice(price: number): number {
    const lo = this.t(this.range.min);
    const hi = this.t(this.range.max);
    const span = hi - lo || 1;
    return this.top + this.height - ((this.t(price) - lo) / span) * this.height;
  }

  priceOfY(y: number): number {
    const lo = this.t(this.range.min);
    const hi = this.t(this.range.max);
    const span = hi - lo || 1;
    return this.tInv(lo + ((this.top + this.height - y) / this.height) * span);
  }

  /** True when `y` lies inside this pane. */
  contains(y: number): boolean {
    return y >= this.top && y <= this.top + this.height;
  }

  /** Scale the range around its vertical centre (price-axis drag). */
  scaleRange(factor: number): void {
    const lo = this.t(this.range.min);
    const hi = this.t(this.range.max);
    const mid = (lo + hi) / 2;
    const half = ((hi - lo) / 2) * factor;
    this.range = { min: this.tInv(mid - half), max: this.tInv(mid + half) };
  }

  /** Shift the range by a pixel delta (vertical drag in manual mode). */
  panRange(dyPixels: number): void {
    const lo = this.t(this.range.min);
    const hi = this.t(this.range.max);
    const span = hi - lo;
    const delta = (dyPixels / this.height) * span;
    this.range = { min: this.tInv(lo + delta), max: this.tInv(hi + delta) };
  }
}

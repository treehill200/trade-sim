/**
 * Chart viewport: the mapping between (bar index, price) and (x, y) pixels.
 *
 * Horizontal position is tracked in *bar index* space rather than time, which
 * is what makes panning feel identical at every timeframe and lets the chart
 * scroll past the newest candle into empty space on the right.
 */

export interface PriceRange {
  min: number; // cents
  max: number; // cents
}

export const MIN_BAR_SPACING = 0.05;
export const MAX_BAR_SPACING = 160;

export class Viewport {
  /** Width of the plot area in CSS pixels (excludes the price axis). */
  width = 0;
  /** Height of the plot area in CSS pixels (excludes the time axis). */
  height = 0;

  /** Horizontal pixels per candle. */
  barSpacing = 8;
  /** Fractional bar index sitting at the right edge of the plot area. */
  rightIndex = 0;

  /** When true the price range follows the visible candles. */
  autoScale = true;
  /** When true prices are laid out on a logarithmic axis. */
  logScale = false;

  /** Active price range in cents; recomputed each frame when auto-scaling. */
  range: PriceRange = { min: 0, max: 1 };

  /** Extra room above and below the visible extremes, as a fraction. */
  paddingTop = 0.12;
  paddingBottom = 0.12;

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

  private t(price: number): number {
    return this.logScale ? Math.log(Math.max(price, 1)) : price;
  }

  private tInv(v: number): number {
    return this.logScale ? Math.exp(v) : v;
  }

  yOfPrice(price: number): number {
    const lo = this.t(this.range.min);
    const hi = this.t(this.range.max);
    const span = hi - lo || 1;
    return this.height - ((this.t(price) - lo) / span) * this.height;
  }

  priceOfY(y: number): number {
    const lo = this.t(this.range.min);
    const hi = this.t(this.range.max);
    const span = hi - lo || 1;
    return this.tInv(lo + ((this.height - y) / this.height) * span);
  }

  /** Pixels per cent at the current range; used for drag-to-scale. */
  pixelsPerPrice(): number {
    const lo = this.t(this.range.min);
    const hi = this.t(this.range.max);
    return this.height / (hi - lo || 1);
  }

  /** Most empty space allowed to the right of the newest candle, in pixels. */
  maxRightMarginPx(): number {
    return this.width * 0.4;
  }

  /** Change zoom without moving the scroll position. */
  setBarSpacing(next: number): void {
    this.barSpacing = clamp(next, MIN_BAR_SPACING, MAX_BAR_SPACING);
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

  /** Zoom around a pixel anchor, keeping the bar under the cursor in place. */
  zoomAt(x: number, factor: number): void {
    const anchorIndex = this.indexOfX(x);
    const next = clamp(this.barSpacing * factor, MIN_BAR_SPACING, MAX_BAR_SPACING);
    if (next === this.barSpacing) return;
    this.barSpacing = next;
    // Re-derive rightIndex so `anchorIndex` maps back to the same x.
    this.rightIndex = anchorIndex + (this.width - x) / this.barSpacing;
  }

  /** Scale the price range around its vertical centre (price-axis drag). */
  scaleRange(factor: number): void {
    const lo = this.t(this.range.min);
    const hi = this.t(this.range.max);
    const mid = (lo + hi) / 2;
    const half = ((hi - lo) / 2) * factor;
    this.range = { min: this.tInv(mid - half), max: this.tInv(mid + half) };
  }

  /** Shift the price range by a pixel delta (vertical drag in manual mode). */
  panRange(dyPixels: number): void {
    const lo = this.t(this.range.min);
    const hi = this.t(this.range.max);
    const span = hi - lo;
    const delta = (dyPixels / this.height) * span;
    this.range = { min: this.tInv(lo + delta), max: this.tInv(hi + delta) };
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

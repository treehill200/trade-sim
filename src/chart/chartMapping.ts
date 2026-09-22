import type { DrawingMap } from '@/drawings/mapping';
import type { Bounds } from '@/drawings/geometry';

/**
 * The chart's current mapping, published for overlays.
 *
 * HTML controls that sit on top of the canvas — the buttons on an order line —
 * need to know where a price lands on screen. Publishing the mapping through a
 * plain holder rather than React state means the chart can pan and zoom at
 * sixty frames a second without re-rendering anything.
 */
export const chartMapping: {
  map: DrawingMap | null;
  bounds: Bounds;
  /** Width of the price axis, so overlays can sit clear of it. */
  axisWidth: number;
} = {
  map: null,
  bounds: { width: 0, top: 0, height: 0 },
  axisWidth: 0,
};

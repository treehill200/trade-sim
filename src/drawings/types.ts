/**
 * Drawings are anchored in data space, never in pixels.
 *
 * A point is a timestamp and a price, so a trend line drawn on the 5m chart
 * sits across exactly the same candles on the 1h chart, survives any amount of
 * panning and zooming, and can be saved and restored without knowing anything
 * about the viewport it was drawn in.
 */
export interface DrawingPoint {
  /** Milliseconds since the epoch. */
  time: number;
  /** Price in cents. */
  price: number;
}

export const DRAWING_TOOLS = [
  'cursor',
  'trendline',
  'ray',
  'extended',
  'hline',
  'hray',
  'vline',
  'channel',
  'rect',
  'fib',
  'long',
  'short',
  'priceRange',
  'dateRange',
  'text',
  'arrow',
  'brush',
] as const;

export type DrawingTool = (typeof DRAWING_TOOLS)[number];

export type DashStyle = 'solid' | 'dashed' | 'dotted';

export interface DrawingStyle {
  color: string;
  width: number;
  dash: DashStyle;
  /** Fill for shapes that enclose an area. */
  fill: string;
  fontSize: number;
}

export interface Drawing {
  id: string;
  tool: Exclude<DrawingTool, 'cursor'>;
  points: DrawingPoint[];
  style: DrawingStyle;
  /** Label content for the text tool. */
  text?: string;
  locked: boolean;
  visible: boolean;
}

/** How many points a tool needs before it is finished. */
export const TOOL_POINTS: Record<Exclude<DrawingTool, 'cursor'>, number> = {
  trendline: 2,
  ray: 2,
  extended: 2,
  hline: 1,
  hray: 1,
  vline: 1,
  channel: 3,
  rect: 2,
  fib: 2,
  long: 3,
  short: 3,
  priceRange: 2,
  dateRange: 2,
  text: 1,
  arrow: 2,
  brush: Number.POSITIVE_INFINITY,
};

export const TOOL_LABELS: Record<Exclude<DrawingTool, 'cursor'>, string> = {
  trendline: 'Trend line',
  ray: 'Ray',
  extended: 'Extended line',
  hline: 'Horizontal line',
  hray: 'Horizontal ray',
  vline: 'Vertical line',
  channel: 'Parallel channel',
  rect: 'Rectangle',
  fib: 'Fib retracement',
  long: 'Long position',
  short: 'Short position',
  priceRange: 'Price range',
  dateRange: 'Date range',
  text: 'Text',
  arrow: 'Arrow',
  brush: 'Brush',
};

/** Fibonacci retracement levels, drawn from the first point to the second. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export const DEFAULT_STYLE: DrawingStyle = {
  color: '#4d9cf6',
  width: 2,
  dash: 'solid',
  fill: 'rgba(77, 156, 246, 0.12)',
  fontSize: 13,
};

/** Tools whose second point only carries a price, not a time. */
export function isHorizontalOnly(tool: Drawing['tool']): boolean {
  return tool === 'hline' || tool === 'hray';
}

export function dashPattern(dash: DashStyle, dpr: number): number[] {
  if (dash === 'dashed') return [6 / dpr, 5 / dpr];
  if (dash === 'dotted') return [1.5 / dpr, 3 / dpr];
  return [];
}

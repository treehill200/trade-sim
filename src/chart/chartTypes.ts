export const CHART_TYPES = ['candles', 'hollow', 'bars', 'heikin', 'line', 'area'] as const;

export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  candles: 'Candles',
  hollow: 'Hollow candles',
  bars: 'Bars (OHLC)',
  heikin: 'Heikin Ashi',
  line: 'Line',
  area: 'Area',
};

/** Line and area charts only ever show the closing price. */
export function isCloseOnly(type: ChartType): boolean {
  return type === 'line' || type === 'area';
}

export function parseChartType(value: string): ChartType | null {
  return (CHART_TYPES as readonly string[]).includes(value) ? (value as ChartType) : null;
}

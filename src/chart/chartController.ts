import type { DateRange } from '@/state/store';

/**
 * Actions the chart exposes to the rest of the UI.
 *
 * The toolbar's camera button and the bottom bar's date-range buttons need to
 * drive the chart, but the chart's viewport deliberately lives outside React
 * state so that panning never triggers a re-render. This small handle is how
 * they reach it.
 */
export interface ChartController {
  /** Fit a span of time on screen and stay pinned to the live edge. */
  setDateRange: (range: DateRange) => void;
  /** Back to the default zoom, scrolled to now. */
  resetView: () => void;
  scrollToRealtime: () => void;
  /** Download the chart as a PNG. */
  screenshot: () => void;
}

export const chartController: { current: ChartController | null } = { current: null };

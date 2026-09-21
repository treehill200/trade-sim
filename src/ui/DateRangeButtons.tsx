import { chartController } from '@/chart/chartController';
import { useUi, type DateRange } from '@/state/store';

const RANGES: DateRange[] = ['1D', '5D', '1M', 'All'];

/** Fit a span of history on screen — the bottom-left range shortcuts. */
export function DateRangeButtons(): JSX.Element {
  const active = useUi((s) => s.activeRange);
  return (
    <div className="range-buttons">
      {RANGES.map((r) => (
        <button
          key={r}
          className={`range-button ${r === active ? 'active' : ''}`}
          onClick={() => chartController.current?.setDateRange(r)}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

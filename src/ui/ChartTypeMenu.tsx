import { useEffect, useRef, useState } from 'react';
import {
  AreaChart,
  BarChart2,
  CandlestickChart,
  ChevronDown,
  LineChart,
  Squircle,
  Wind,
} from 'lucide-react';
import { CHART_TYPES, CHART_TYPE_LABELS, type ChartType } from '@/chart/chartTypes';
import { useUi } from '@/state/store';

const ICONS: Record<ChartType, typeof CandlestickChart> = {
  candles: CandlestickChart,
  hollow: Squircle,
  bars: BarChart2,
  heikin: Wind,
  line: LineChart,
  area: AreaChart,
};

export function ChartTypeMenu(): JSX.Element {
  const chartType = useUi((s) => s.chartType);
  const setChartType = useUi((s) => s.setChartType);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const Current = ICONS[chartType];

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        className={`icon-button wide ${open ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={`Chart type: ${CHART_TYPE_LABELS[chartType]}`}
      >
        <Current size={16} />
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="menu-popover">
          {CHART_TYPES.map((t) => {
            const Icon = ICONS[t];
            return (
              <button
                key={t}
                className={`menu-item ${t === chartType ? 'selected' : ''}`}
                onClick={() => {
                  setChartType(t);
                  setOpen(false);
                }}
              >
                <Icon size={15} />
                <span>{CHART_TYPE_LABELS[t]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

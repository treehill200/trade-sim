import type { IndicatorInstance } from '@/indicators/types';
import { IndicatorLegendRow } from './IndicatorLegend';
import { useIndicatorSettings } from './IndicatorSettingsContext';

export interface PaneLegendRow {
  rect: { id: string; top: number; height: number };
  instance: IndicatorInstance;
}

/**
 * Legends for the indicator panes, positioned over the canvas.
 *
 * Kept as HTML rather than canvas text so the type stays crisp at any device
 * pixel ratio and the eye/gear/close controls can just be buttons.
 */
export function PaneLegends({
  rows,
  hoverIndex,
}: {
  rows: PaneLegendRow[];
  hoverIndex: number | null;
}): JSX.Element {
  const { open } = useIndicatorSettings();
  return (
    <>
      {rows.map(({ rect, instance }) => (
        <div key={rect.id} className="pane-legend" style={{ top: rect.top + 4 }}>
          <IndicatorLegendRow instance={instance} hoverIndex={hoverIndex} onOpenSettings={open} />
        </div>
      ))}
    </>
  );
}

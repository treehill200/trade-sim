import { Eye, EyeOff, Settings2, X } from 'lucide-react';
import { indicatorDef } from '@/indicators/defs';
import { indicatorEngine } from '@/indicators/engine';
import type { IndicatorInstance, ValueFormat } from '@/indicators/types';
import { useUi } from '@/state/store';
import { formatCents, formatVolume } from '@/chart/format';

function formatValue(v: number, format: ValueFormat): string {
  if (Number.isNaN(v)) return '—';
  if (format === 'volume') return formatVolume(v);
  if (format === 'number') return v.toFixed(2);
  return formatCents(v);
}

interface Props {
  instance: IndicatorInstance;
  /** Candle under the cursor, or null to read the newest candle. */
  hoverIndex: number | null;
  onOpenSettings: (id: string) => void;
}

/**
 * One line of the chart legend for a configured indicator.
 *
 * Values come from the render loop's cached results, so hovering never causes
 * the indicator to be recomputed.
 */
export function IndicatorLegendRow({ instance, hoverIndex, onOpenSettings }: Props): JSX.Element | null {
  const toggleIndicator = useUi((s) => s.toggleIndicator);
  const removeIndicator = useUi((s) => s.removeIndicator);

  const def = indicatorDef(instance.defId);
  if (!def) return null;
  const result = indicatorEngine.peek(instance.id);
  const index = hoverIndex ?? (result ? result.length - 1 : -1);

  return (
    <div className={`indicator-legend ${instance.visible ? '' : 'hidden-indicator'}`}>
      <span className="ind-name">{def.short}</span>
      {def.subtitle(instance.params) && (
        <span className="ind-params">{def.subtitle(instance.params)}</span>
      )}
      {result &&
        index >= 0 &&
        index < result.length &&
        def.outputs.map((spec, k) => (
          <span
            key={spec.key}
            className="ind-value"
            style={{ color: instance.colors[spec.key] ?? spec.color }}
          >
            {formatValue((result.outputs[k] as Float64Array)[index] as number, def.format)}
          </span>
        ))}
      <span className="ind-actions">
        <button
          className="ind-button"
          title={instance.visible ? 'Hide' : 'Show'}
          onClick={() => toggleIndicator(instance.id)}
        >
          {instance.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <button className="ind-button" title="Settings" onClick={() => onOpenSettings(instance.id)}>
          <Settings2 size={13} />
        </button>
        <button className="ind-button" title="Remove" onClick={() => removeIndicator(instance.id)}>
          <X size={13} />
        </button>
      </span>
    </div>
  );
}

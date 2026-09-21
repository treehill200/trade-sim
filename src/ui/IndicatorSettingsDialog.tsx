import { useEffect } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { indicatorDef } from '@/indicators/defs';
import { defaultColors, defaultParams, defaultWidths } from '@/indicators/types';
import { useUi } from '@/state/store';

const WIDTHS = [1, 2, 3, 4];

/** Inputs, colours and line widths for one configured indicator. */
export function IndicatorSettingsDialog({
  instanceId,
  onClose,
}: {
  instanceId: string;
  onClose: () => void;
}): JSX.Element | null {
  const instance = useUi((s) => s.indicators.find((i) => i.id === instanceId));
  const updateIndicator = useUi((s) => s.updateIndicator);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const def = instance ? indicatorDef(instance.defId) : undefined;
  if (!instance || !def) return null;

  const reset = (): void => {
    updateIndicator(instance.id, {
      params: defaultParams(def),
      colors: defaultColors(def),
      widths: defaultWidths(def),
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal modal-narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{def.name}</h2>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {def.params.length > 0 && <h3 className="modal-group">Inputs</h3>}
          {def.params.map((p) => (
            <label key={p.key} className="settings-row">
              <span>{p.label}</span>
              <input
                type="number"
                min={p.min}
                max={p.max}
                step={p.step}
                value={instance.params[p.key] ?? p.default}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (!Number.isFinite(raw)) return;
                  const value = Math.min(p.max, Math.max(p.min, raw));
                  updateIndicator(instance.id, {
                    params: { ...instance.params, [p.key]: value },
                  });
                }}
              />
            </label>
          ))}

          <h3 className="modal-group">Style</h3>
          {def.outputs.map((o) => (
            <div key={o.key} className="settings-row">
              <span>{o.label}</span>
              <span className="settings-style">
                <input
                  type="color"
                  aria-label={`${o.label} colour`}
                  value={toHex(instance.colors[o.key] ?? o.color)}
                  onChange={(e) =>
                    updateIndicator(instance.id, {
                      colors: { ...instance.colors, [o.key]: e.target.value },
                    })
                  }
                />
                <select
                  aria-label={`${o.label} width`}
                  value={instance.widths[o.key] ?? o.width}
                  onChange={(e) =>
                    updateIndicator(instance.id, {
                      widths: { ...instance.widths, [o.key]: Number(e.target.value) },
                    })
                  }
                >
                  {WIDTHS.map((w) => (
                    <option key={w} value={w}>
                      {w}px
                    </option>
                  ))}
                </select>
              </span>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="text-button" onClick={reset}>
            <RotateCcw size={13} /> Reset to defaults
          </button>
          <button className="primary-button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * `<input type="color">` only accepts `#rrggbb`.
 *
 * Some defaults are `rgba(...)` because they are fills, so those fall back to
 * a neutral swatch rather than being rejected by the browser.
 */
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return '#888888';
  const hex = (v: string): string => Number(v).toString(16).padStart(2, '0');
  return `#${hex(m[1] as string)}${hex(m[2] as string)}${hex(m[3] as string)}`;
}

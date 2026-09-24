import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Minus, Plus, Search, X } from 'lucide-react';
import { INDICATOR_DEFS } from '@/indicators/defs';
import { useUi } from '@/state/store';

/** Searchable list of everything that can be added to the chart. */
export function IndicatorsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const addIndicator = useUi((s) => s.addIndicator);
  const removeIndicatorByDef = useUi((s) => s.removeIndicatorByDef);
  const indicators = useUi((s) => s.indicators);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return INDICATOR_DEFS;
    return INDICATOR_DEFS.filter((d) =>
      `${d.name} ${d.short} ${d.description}`.toLowerCase().includes(q),
    );
  }, [query]);

  const added = useMemo(() => new Set(indicators.map((i) => i.defId)), [indicators]);

  /** Clicking a row adds the indicator, or takes it off if it is already on. */
  const toggle = (defId: string): void => {
    if (added.has(defId)) removeIndicatorByDef(defId);
    else addIndicator(defId);
  };

  const overlays = results.filter((d) => d.overlay);
  const panes = results.filter((d) => !d.overlay);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Indicators</h2>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-search">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search indicators"
            aria-label="Search indicators"
          />
        </div>
        <div className="modal-body">
          {results.length === 0 && <p className="modal-empty">Nothing matches “{query}”.</p>}
          {overlays.length > 0 && <h3 className="modal-group">On the price chart</h3>}
          {overlays.map((d) => (
            <IndicatorRow key={d.id} def={d} on={added.has(d.id)} onToggle={toggle} />
          ))}
          {panes.length > 0 && <h3 className="modal-group">In their own pane</h3>}
          {panes.map((d) => (
            <IndicatorRow key={d.id} def={d} on={added.has(d.id)} onToggle={toggle} />
          ))}
        </div>
      </div>
    </div>
  );
}

function IndicatorRow({
  def,
  on,
  onToggle,
}: {
  def: (typeof INDICATOR_DEFS)[number];
  on: boolean;
  onToggle: (id: string) => void;
}): JSX.Element {
  return (
    <button
      className={`indicator-row ${on ? 'on' : ''}`}
      onClick={() => onToggle(def.id)}
      title={on ? `Remove ${def.name} from the chart` : `Add ${def.name} to the chart`}
    >
      <span className="indicator-row-main">
        <span className="indicator-row-name">{def.name}</span>
        <span className="indicator-row-desc">{def.description}</span>
      </span>
      {/* Two labels, one shown at a time: the state you are in, and what a
          click would do. The second only appears on hover. */}
      <span className="indicator-row-action">
        {on ? (
          <>
            <span className="row-state">
              <Check size={14} /> Added
            </span>
            <span className="row-hint remove">
              <Minus size={14} /> Remove
            </span>
          </>
        ) : (
          <>
            <span className="row-state">
              <Plus size={14} />
            </span>
            <span className="row-hint">
              <Plus size={14} /> Add
            </span>
          </>
        )}
      </span>
    </button>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { INDICATOR_DEFS } from '@/indicators/defs';
import { useUi } from '@/state/store';

/** Searchable list of everything that can be added to the chart. */
export function IndicatorsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const addIndicator = useUi((s) => s.addIndicator);
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

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of indicators) map.set(i.defId, (map.get(i.defId) ?? 0) + 1);
    return map;
  }, [indicators]);

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
            <IndicatorRow key={d.id} def={d} count={counts.get(d.id) ?? 0} onAdd={addIndicator} />
          ))}
          {panes.length > 0 && <h3 className="modal-group">In their own pane</h3>}
          {panes.map((d) => (
            <IndicatorRow key={d.id} def={d} count={counts.get(d.id) ?? 0} onAdd={addIndicator} />
          ))}
        </div>
      </div>
    </div>
  );
}

function IndicatorRow({
  def,
  count,
  onAdd,
}: {
  def: (typeof INDICATOR_DEFS)[number];
  count: number;
  onAdd: (id: string) => void;
}): JSX.Element {
  return (
    <button className="indicator-row" onClick={() => onAdd(def.id)}>
      <span className="indicator-row-main">
        <span className="indicator-row-name">{def.name}</span>
        <span className="indicator-row-desc">{def.description}</span>
      </span>
      <span className="indicator-row-action">
        {count > 0 ? (
          <>
            <Check size={14} />
            {count > 1 ? ` ${count}` : ''}
          </>
        ) : (
          <Plus size={14} />
        )}
      </span>
    </button>
  );
}

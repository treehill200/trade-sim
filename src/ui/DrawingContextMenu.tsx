import { useEffect, useRef } from 'react';
import { Copy, Lock, LockOpen, Trash2 } from 'lucide-react';
import { useDrawings } from '@/state/drawingsStore';
import type { DashStyle } from '@/drawings/types';

const COLORS = [
  '#4d9cf6',
  '#26a96c',
  '#e2445c',
  '#f2b03d',
  '#b06df2',
  '#22c5c5',
  '#d5d9e3',
  '#787b86',
];

const WIDTHS = [1, 2, 3, 4];
const DASHES: DashStyle[] = ['solid', 'dashed', 'dotted'];

/** Right-click menu for a drawing: style, clone, lock, delete. */
export function DrawingContextMenu({
  x,
  y,
  id,
  onClose,
}: {
  x: number;
  y: number;
  id: string;
  onClose: () => void;
}): JSX.Element | null {
  const drawing = useDrawings((s) => s.drawings.find((d) => d.id === id));
  const update = useDrawings((s) => s.update);
  const setStyle = useDrawings((s) => s.setStyle);
  const remove = useDrawings((s) => s.remove);
  const clone = useDrawings((s) => s.clone);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!drawing) return null;

  return (
    <div className="draw-menu" style={{ left: x, top: y }} ref={ref}>
      <div className="draw-menu-row">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`swatch ${drawing.style.color === c ? 'selected' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => setStyle({ color: c, fill: withAlpha(c, 0.12) })}
          />
        ))}
      </div>
      <div className="draw-menu-row">
        {WIDTHS.map((w) => (
          <button
            key={w}
            className={`chip ${drawing.style.width === w ? 'selected' : ''}`}
            onClick={() => setStyle({ width: w })}
          >
            {w}px
          </button>
        ))}
      </div>
      <div className="draw-menu-row">
        {DASHES.map((d) => (
          <button
            key={d}
            className={`chip ${drawing.style.dash === d ? 'selected' : ''}`}
            onClick={() => setStyle({ dash: d })}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="draw-menu-sep" />
      <button className="menu-item" onClick={() => { clone(id); onClose(); }}>
        <Copy size={15} />
        <span>Clone</span>
      </button>
      <button
        className="menu-item"
        onClick={() => {
          update(id, { locked: !drawing.locked });
          onClose();
        }}
      >
        {drawing.locked ? <LockOpen size={15} /> : <Lock size={15} />}
        <span>{drawing.locked ? 'Unlock' : 'Lock'}</span>
      </button>
      <button className="menu-item danger" onClick={() => { remove(id); onClose(); }}>
        <Trash2 size={15} />
        <span>Delete</span>
      </button>
    </div>
  );
}

/** Matching translucent fill for a chosen line colour. */
function withAlpha(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

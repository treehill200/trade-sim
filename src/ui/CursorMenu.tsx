import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Crosshair, Dot, MousePointer2 } from 'lucide-react';
import { useUi, type CursorMode } from '@/state/store';

const MODES: { id: CursorMode; label: string; Icon: typeof Crosshair }[] = [
  { id: 'cross', label: 'Cross', Icon: Crosshair },
  { id: 'dot', label: 'Dot', Icon: Dot },
  { id: 'arrow', label: 'Arrow', Icon: MousePointer2 },
];

export function CursorMenu(): JSX.Element {
  const cursorMode = useUi((s) => s.cursorMode);
  const setCursorMode = useUi((s) => s.setCursorMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = MODES.find((m) => m.id === cursorMode) ?? MODES[0]!;

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        className={`icon-button wide ${open ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={`Cursor: ${current.label}`}
      >
        <current.Icon size={16} />
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="menu-popover">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`menu-item ${id === cursorMode ? 'selected' : ''}`}
              onClick={() => {
                setCursorMode(id);
                setOpen(false);
              }}
            >
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

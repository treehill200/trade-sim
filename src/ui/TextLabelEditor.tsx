import { useEffect, useRef, useState } from 'react';
import { useDrawings } from '@/state/drawingsStore';

/**
 * Inline editor for a text label, positioned where the label sits.
 *
 * A label with no text is removed on close, so clicking with the text tool and
 * changing your mind does not leave an invisible drawing behind.
 */
export function TextLabelEditor({
  x,
  y,
  id,
  onClose,
}: {
  x: number;
  y: number;
  id: string;
  onClose: () => void;
}): JSX.Element {
  const drawing = useDrawings((s) => s.drawings.find((d) => d.id === id));
  const update = useDrawings((s) => s.update);
  const remove = useDrawings((s) => s.remove);
  const [value, setValue] = useState(drawing?.text ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  /** Blur is ignored until the field has genuinely been focused once. */
  const focused = useRef(false);

  useEffect(() => {
    // One frame's delay, so the click that opened the editor cannot steal
    // focus straight back.
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const finish = (save: boolean): void => {
    const text = value.trim();
    if (!save || text.length === 0) remove(id);
    else update(id, { text });
    onClose();
  };

  return (
    <div className="text-editor" style={{ left: x, top: y - 14 }}>
      <input
        ref={inputRef}
        value={value}
        placeholder="Label"
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          if (focused.current) finish(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
          e.stopPropagation();
        }}
      />
    </div>
  );
}

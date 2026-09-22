import { useEffect } from 'react';
import { X } from 'lucide-react';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Chart',
    rows: [
      ['Drag', 'Pan'],
      ['Wheel / pinch', 'Zoom'],
      ['Drag the price axis', 'Stretch the price scale'],
      ['Drag the time axis', 'Stretch the time scale'],
      ['Double-click', 'Reset the view'],
      ['Double-click the price axis', 'Back to auto-scale'],
    ],
  },
  {
    title: 'Drawings',
    rows: [
      ['Esc', 'Cancel the drawing in progress, or return to the cursor'],
      ['Delete / Backspace', 'Remove the selected drawing'],
      ['Alt + H', 'Horizontal line at the crosshair'],
      ['Cmd / Ctrl + Z', 'Undo'],
      ['Cmd / Ctrl + Shift + Z', 'Redo'],
      ['Right-click a drawing', 'Colour, width, dash, clone, lock, delete'],
    ],
  },
  {
    title: 'Trading',
    rows: [
      ['Alt + A', 'Price alert at the crosshair'],
      ['Click a DOM level', 'Limit order there'],
      ['Shift-click a DOM level', 'Stop order there'],
      ['Drag an order line', 'Move that order'],
    ],
  },
  {
    title: 'Help',
    rows: [['?', 'This list']],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Keyboard and mouse</h2>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="modal-group">{group.title}</h3>
              {group.rows.map(([keys, what]) => (
                <div className="shortcut-row" key={keys}>
                  <kbd>{keys}</kbd>
                  <span>{what}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

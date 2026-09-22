import { useEffect, useRef, useState } from 'react';
import {
  AlignVerticalDistributeCenter,
  ArrowRight,
  ArrowUpDown,
  Brush,
  CalendarRange,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Minus,
  MoveDiagonal,
  MoveUpRight,
  MousePointer2,
  Redo2,
  Rows3,
  SeparatorVertical,
  Square,
  SquareArrowDown,
  SquareArrowUp,
  Trash2,
  TrendingUp,
  Type,
  Undo2,
} from 'lucide-react';
import { TOOL_LABELS, type DrawingTool } from '@/drawings/types';
import { useDrawings } from '@/state/drawingsStore';

type Icon = typeof TrendingUp;

const TOOL_ICONS: Record<Exclude<DrawingTool, 'cursor'>, Icon> = {
  trendline: TrendingUp,
  ray: MoveUpRight,
  extended: MoveDiagonal,
  hline: Minus,
  hray: ArrowRight,
  vline: SeparatorVertical,
  channel: Rows3,
  rect: Square,
  fib: AlignVerticalDistributeCenter,
  long: SquareArrowUp,
  short: SquareArrowDown,
  priceRange: ArrowUpDown,
  dateRange: CalendarRange,
  text: Type,
  arrow: MoveUpRight,
  brush: Brush,
};

/** Tools are grouped the way a charting terminal groups them. */
const GROUPS: { id: string; tools: Exclude<DrawingTool, 'cursor'>[] }[] = [
  { id: 'lines', tools: ['trendline', 'ray', 'extended', 'hline', 'hray', 'vline'] },
  { id: 'shapes', tools: ['channel', 'rect'] },
  { id: 'fib', tools: ['fib'] },
  { id: 'positions', tools: ['long', 'short'] },
  { id: 'measure', tools: ['priceRange', 'dateRange'] },
  { id: 'annotate', tools: ['text', 'arrow', 'brush'] },
];

export function DrawingToolbar(): JSX.Element {
  const tool = useDrawings((s) => s.tool);
  const setTool = useDrawings((s) => s.setTool);
  const magnet = useDrawings((s) => s.magnet);
  const locked = useDrawings((s) => s.locked);
  const hidden = useDrawings((s) => s.hidden);
  const toggleMagnet = useDrawings((s) => s.toggleMagnet);
  const toggleLocked = useDrawings((s) => s.toggleLocked);
  const toggleHidden = useDrawings((s) => s.toggleHidden);
  const removeAll = useDrawings((s) => s.removeAll);
  const undo = useDrawings((s) => s.undo);
  const redo = useDrawings((s) => s.redo);
  const count = useDrawings((s) => s.drawings.length);

  /** The tool each group shows when closed: whatever you last picked from it. */
  const [lastPicked, setLastPicked] = useState<Record<string, Exclude<DrawingTool, 'cursor'>>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.id, g.tools[0] as Exclude<DrawingTool, 'cursor'>])),
  );
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openGroup && !confirmClear) return;
    const onDown = (e: MouseEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
        setConfirmClear(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openGroup, confirmClear]);

  return (
    <div className="drawing-rail" ref={railRef}>
      <button
        className={`rail-button ${tool === 'cursor' ? 'active' : ''}`}
        onClick={() => {
          setTool('cursor');
          setOpenGroup(null);
        }}
        title="Select and move (Esc)"
      >
        <MousePointer2 size={16} />
      </button>

      <span className="rail-divider" />

      {GROUPS.map((group) => {
        const current = lastPicked[group.id] as Exclude<DrawingTool, 'cursor'>;
        const Current = TOOL_ICONS[current];
        const groupActive = group.tools.includes(tool as Exclude<DrawingTool, 'cursor'>);
        return (
          <div className="rail-group" key={group.id}>
            <button
              className={`rail-button ${groupActive ? 'active' : ''}`}
              title={TOOL_LABELS[current]}
              onClick={() => {
                setTool(current);
                setOpenGroup(group.tools.length > 1 ? group.id : null);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setOpenGroup(group.id);
              }}
            >
              <Current size={16} />
              {group.tools.length > 1 && <span className="rail-caret" />}
            </button>
            {openGroup === group.id && (
              <div className="rail-flyout">
                {group.tools.map((t) => {
                  const Icon = TOOL_ICONS[t];
                  return (
                    <button
                      key={t}
                      className={`menu-item ${t === tool ? 'selected' : ''}`}
                      onClick={() => {
                        setLastPicked((prev) => ({ ...prev, [group.id]: t }));
                        setTool(t);
                        setOpenGroup(null);
                      }}
                    >
                      <Icon size={15} />
                      <span>{TOOL_LABELS[t]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <span className="rail-divider" />

      <button
        className={`rail-button ${magnet ? 'active' : ''}`}
        onClick={toggleMagnet}
        title="Magnet: snap new points to the nearest open, high, low or close"
      >
        <Magnet size={16} />
      </button>
      <button
        className={`rail-button ${locked ? 'active' : ''}`}
        onClick={toggleLocked}
        title={locked ? 'Unlock all drawings' : 'Lock all drawings'}
      >
        {locked ? <Lock size={16} /> : <LockOpen size={16} />}
      </button>
      <button
        className={`rail-button ${hidden ? 'active' : ''}`}
        onClick={toggleHidden}
        title={hidden ? 'Show all drawings' : 'Hide all drawings'}
      >
        {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>

      <span className="rail-divider" />

      <button className="rail-button" onClick={undo} title="Undo (Cmd/Ctrl+Z)">
        <Undo2 size={16} />
      </button>
      <button className="rail-button" onClick={redo} title="Redo (Cmd/Ctrl+Shift+Z)">
        <Redo2 size={16} />
      </button>

      <div className="rail-group">
        <button
          className="rail-button danger"
          onClick={() => setConfirmClear((v) => !v)}
          title="Remove all drawings"
          disabled={count === 0}
        >
          <Trash2 size={16} />
        </button>
        {confirmClear && (
          <div className="rail-flyout">
            <div className="rail-confirm">
              Remove all {count} drawing{count === 1 ? '' : 's'}?
            </div>
            <button
              className="menu-item danger"
              onClick={() => {
                removeAll();
                setConfirmClear(false);
              }}
            >
              <Trash2 size={15} />
              <span>Remove all</span>
            </button>
            <button className="menu-item" onClick={() => setConfirmClear(false)}>
              <span>Cancel</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

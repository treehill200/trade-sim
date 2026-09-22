import { create } from 'zustand';
import { loadLocal, saveLocal } from '@/storage/local';
import {
  DEFAULT_STYLE,
  type DashStyle,
  type Drawing,
  type DrawingStyle,
  type DrawingTool,
} from '@/drawings/types';

const LS_KEY = 'drawings';
/** How many undo steps to keep. Deep enough to be useful, shallow enough to save. */
const HISTORY_LIMIT = 60;

interface Persisted {
  drawings: Drawing[];
  style: DrawingStyle;
  magnet: boolean;
  locked: boolean;
  hidden: boolean;
}

export interface DrawingsState {
  drawings: Drawing[];
  /** The tool the next click will use; 'cursor' selects instead of drawing. */
  tool: DrawingTool;
  selectedId: string | null;
  /** Style applied to the next drawing, and to the selection when changed. */
  style: DrawingStyle;
  /** Snap new points to the nearest OHLC value of the candle under the cursor. */
  magnet: boolean;
  /** When locked, existing drawings cannot be selected, moved or deleted. */
  locked: boolean;
  /** When hidden, drawings are not rendered and cannot be hit. */
  hidden: boolean;

  setTool: (tool: DrawingTool) => void;
  select: (id: string | null) => void;
  add: (drawing: Drawing) => void;
  update: (id: string, patch: Partial<Drawing>) => void;
  /** Replace a drawing's geometry without pushing a new undo step. */
  moveLive: (id: string, points: Drawing['points']) => void;
  /** Commit whatever `moveLive` has been doing as one undo step. */
  commit: () => void;
  remove: (id: string) => void;
  clone: (id: string) => void;
  removeAll: () => void;
  setStyle: (patch: Partial<DrawingStyle>) => void;
  setDash: (dash: DashStyle) => void;
  toggleMagnet: () => void;
  toggleLocked: () => void;
  toggleHidden: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const defaults: Persisted = {
  drawings: [],
  style: DEFAULT_STYLE,
  magnet: false,
  locked: false,
  hidden: false,
};

const saved = { ...defaults, ...loadLocal<Partial<Persisted>>(LS_KEY, {}) };

/**
 * Drop anything from a saved layout that no longer makes sense.
 *
 * Saved drawings outlive code changes, and a malformed one would otherwise
 * throw while rendering, taking the whole chart with it.
 */
function sanitise(list: unknown): Drawing[] {
  if (!Array.isArray(list)) return [];
  const out: Drawing[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const d = raw as Partial<Drawing>;
    if (typeof d.id !== 'string' || typeof d.tool !== 'string') continue;
    if (!Array.isArray(d.points) || d.points.length === 0) continue;
    const points = d.points.filter(
      (p) => typeof p?.time === 'number' && typeof p?.price === 'number' && Number.isFinite(p.time),
    );
    if (points.length === 0) continue;
    out.push({
      id: d.id,
      tool: d.tool as Drawing['tool'],
      points,
      style: { ...DEFAULT_STYLE, ...(d.style ?? {}) },
      ...(typeof d.text === 'string' ? { text: d.text } : {}),
      locked: d.locked === true,
      visible: d.visible !== false,
    });
  }
  return out;
}

/** Undo history lives outside the store: it is never persisted or rendered. */
let past: Drawing[][] = [];
let future: Drawing[][] = [];
/** Geometry mid-drag, so a whole drag is one undo step rather than dozens. */
let dragBaseline: Drawing[] | null = null;

export function newDrawingId(): string {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useDrawings = create<DrawingsState>((set, get) => {
  const persist = (): void => {
    const s = get();
    saveLocal(LS_KEY, {
      drawings: s.drawings,
      style: s.style,
      magnet: s.magnet,
      locked: s.locked,
      hidden: s.hidden,
    } satisfies Persisted);
  };

  /** Record the current drawings as an undo step, then apply `next`. */
  const commitChange = (next: Drawing[]): void => {
    past.push(get().drawings);
    if (past.length > HISTORY_LIMIT) past.shift();
    future = [];
    dragBaseline = null;
    set({ drawings: next });
    persist();
  };

  return {
    drawings: sanitise(saved.drawings),
    tool: 'cursor',
    selectedId: null,
    style: { ...DEFAULT_STYLE, ...saved.style },
    magnet: saved.magnet,
    locked: saved.locked,
    hidden: saved.hidden,

    setTool: (tool) => set({ tool, selectedId: tool === 'cursor' ? get().selectedId : null }),
    select: (selectedId) => set({ selectedId }),

    add: (drawing) => {
      commitChange([...get().drawings, drawing]);
      set({ selectedId: drawing.id });
    },

    update: (id, patch) => {
      commitChange(get().drawings.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    },

    moveLive: (id, points) => {
      // The first move of a drag remembers where everything started, so undo
      // jumps back to before the drag rather than one mouse-move at a time.
      if (!dragBaseline) dragBaseline = get().drawings;
      set({ drawings: get().drawings.map((d) => (d.id === id ? { ...d, points } : d)) });
    },

    commit: () => {
      if (!dragBaseline) return;
      past.push(dragBaseline);
      if (past.length > HISTORY_LIMIT) past.shift();
      future = [];
      dragBaseline = null;
      persist();
    },

    remove: (id) => {
      commitChange(get().drawings.filter((d) => d.id !== id));
      if (get().selectedId === id) set({ selectedId: null });
    },

    clone: (id) => {
      const source = get().drawings.find((d) => d.id === id);
      if (!source) return;
      const copy: Drawing = {
        ...source,
        id: newDrawingId(),
        // Nudge the copy down a little so it is visibly a separate object.
        points: source.points.map((p) => ({ ...p, price: p.price * 0.997 })),
      };
      commitChange([...get().drawings, copy]);
      set({ selectedId: copy.id });
    },

    removeAll: () => {
      commitChange([]);
      set({ selectedId: null });
    },

    setStyle: (patch) => {
      const style = { ...get().style, ...patch };
      const id = get().selectedId;
      if (id) {
        commitChange(
          get().drawings.map((d) => (d.id === id ? { ...d, style: { ...d.style, ...patch } } : d)),
        );
      }
      set({ style });
      persist();
    },

    setDash: (dash) => get().setStyle({ dash }),

    toggleMagnet: () => {
      set({ magnet: !get().magnet });
      persist();
    },
    toggleLocked: () => {
      set({ locked: !get().locked, selectedId: null });
      persist();
    },
    toggleHidden: () => {
      set({ hidden: !get().hidden, selectedId: null });
      persist();
    },

    undo: () => {
      const prev = past.pop();
      if (!prev) return;
      future.push(get().drawings);
      set({ drawings: prev, selectedId: null });
      persist();
    },

    redo: () => {
      const next = future.pop();
      if (!next) return;
      past.push(get().drawings);
      set({ drawings: next, selectedId: null });
      persist();
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
});

/** Test seam: reset the module-level history between cases. */
export function resetDrawingHistory(): void {
  past = [];
  future = [];
  dragBaseline = null;
}

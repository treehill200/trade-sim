import type { DrawingMap } from './mapping';
import { FIB_LEVELS, type Drawing, type DrawingPoint } from './types';

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which of the drawing's own colours this area should take. */
  tone?: 'profit' | 'loss' | 'neutral';
}

/**
 * A drawing resolved into screen coordinates.
 *
 * The renderer and the hit test both work from this, so anything you can see
 * is exactly what you can click — the two can never drift apart.
 */
export interface Shape {
  segments: Segment[];
  areas: Area[];
  /** Filled polygons, for shapes that are not axis-aligned. */
  polygons?: { x: number; y: number }[][];
  /** Draggable points, in the same order as `drawing.points`. */
  handles: { x: number; y: number }[];
  /** Text anchor, for the label tool. */
  label?: { x: number; y: number };
}

export interface Bounds {
  width: number;
  top: number;
  height: number;
}

/** Where a ray or extended line leaves the plot area. */
function extend(x1: number, y1: number, x2: number, y2: number, bounds: Bounds, backwards: boolean): Segment {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return { x1, y1, x2, y2 };
  // Scale the direction vector until it is certainly outside the plot area;
  // the stroke is clipped to the pane anyway.
  const span = Math.hypot(bounds.width, bounds.height) * 2;
  const len = Math.hypot(dx, dy);
  const ux = (dx / len) * span;
  const uy = (dy / len) * span;
  return backwards
    ? { x1: x1 - ux, y1: y1 - uy, x2: x2 + ux, y2: y2 + uy }
    : { x1, y1, x2: x1 + ux, y2: y1 + uy };
}

function screen(map: DrawingMap, p: DrawingPoint): { x: number; y: number } {
  return { x: map.xOfTime(p.time), y: map.yOfPrice(p.price) };
}

/** Resolve a drawing into the segments, areas and handles that represent it. */
export function resolveShape(drawing: Drawing, map: DrawingMap, bounds: Bounds): Shape {
  const pts = drawing.points.map((p) => screen(map, p));
  const a = pts[0];
  const b = pts[1];
  const c = pts[2];
  const top = bounds.top;
  const bottom = bounds.top + bounds.height;
  const empty: Shape = { segments: [], areas: [], handles: pts };
  if (!a) return empty;

  switch (drawing.tool) {
    case 'trendline':
      if (!b) return empty;
      return { segments: [{ x1: a.x, y1: a.y, x2: b.x, y2: b.y }], areas: [], handles: pts };

    case 'ray':
      if (!b) return empty;
      return { segments: [extend(a.x, a.y, b.x, b.y, bounds, false)], areas: [], handles: pts };

    case 'extended':
      if (!b) return empty;
      return { segments: [extend(a.x, a.y, b.x, b.y, bounds, true)], areas: [], handles: pts };

    case 'hline':
      return { segments: [{ x1: 0, y1: a.y, x2: bounds.width, y2: a.y }], areas: [], handles: pts };

    case 'hray':
      return {
        segments: [{ x1: a.x, y1: a.y, x2: bounds.width, y2: a.y }],
        areas: [],
        handles: pts,
      };

    case 'vline':
      return { segments: [{ x1: a.x, y1: top, x2: a.x, y2: bottom }], areas: [], handles: pts };

    case 'arrow':
      if (!b) return empty;
      return { segments: [{ x1: a.x, y1: a.y, x2: b.x, y2: b.y }], areas: [], handles: pts };

    case 'brush': {
      const segments: Segment[] = [];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1] as { x: number; y: number };
        const q = pts[i] as { x: number; y: number };
        segments.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
      }
      // Only the ends are draggable; every stroke point would be unusable.
      const ends = pts.length > 1 ? [pts[0] as { x: number; y: number }, pts[pts.length - 1] as { x: number; y: number }] : pts;
      return { segments, areas: [], handles: ends };
    }

    case 'rect':
    case 'priceRange':
    case 'dateRange': {
      if (!b) return empty;
      // A price range spans the full drawn width; a date range spans the pane.
      const x = Math.min(a.x, b.x);
      const w = Math.abs(b.x - a.x);
      const y = drawing.tool === 'dateRange' ? top : Math.min(a.y, b.y);
      const h = drawing.tool === 'dateRange' ? bounds.height : Math.abs(b.y - a.y);
      return {
        segments: [
          { x1: x, y1: y, x2: x + w, y2: y },
          { x1: x + w, y1: y, x2: x + w, y2: y + h },
          { x1: x + w, y1: y + h, x2: x, y2: y + h },
          { x1: x, y1: y + h, x2: x, y2: y },
        ],
        areas: [{ x, y, w, h }],
        handles: pts,
      };
    }

    case 'channel': {
      if (!b) return empty;
      const offset = c ? c.y - a.y : 0;
      return {
        segments: [
          { x1: a.x, y1: a.y, x2: b.x, y2: b.y },
          { x1: a.x, y1: a.y + offset, x2: b.x, y2: b.y + offset },
        ],
        areas: [],
        // A channel is a parallelogram, so it needs a polygon rather than the
        // axis-aligned rectangles the other shapes use.
        polygons: [
          [
            { x: a.x, y: a.y },
            { x: b.x, y: b.y },
            { x: b.x, y: b.y + offset },
            { x: a.x, y: a.y + offset },
          ],
        ],
        handles: pts,
      };
    }

    case 'fib': {
      if (!b) return empty;
      const x = Math.min(a.x, b.x);
      const w = Math.max(Math.abs(b.x - a.x), 1);
      const segments: Segment[] = FIB_LEVELS.map((level) => {
        const y = a.y + (b.y - a.y) * level;
        return { x1: x, y1: y, x2: x + w, y2: y };
      });
      const areas: Area[] = [];
      for (let i = 1; i < FIB_LEVELS.length; i++) {
        const yA = a.y + (b.y - a.y) * (FIB_LEVELS[i - 1] as number);
        const yB = a.y + (b.y - a.y) * (FIB_LEVELS[i] as number);
        areas.push({ x, y: Math.min(yA, yB), w, h: Math.abs(yB - yA) });
      }
      return { segments, areas, handles: pts };
    }

    case 'long':
    case 'short': {
      if (!b || !c) return empty;
      const x = Math.min(a.x, b.x);
      const w = Math.max(Math.abs(b.x - a.x), 1);
      const entryY = a.y;
      const targetY = b.y;
      const stopY = c.y;
      return {
        segments: [
          { x1: x, y1: entryY, x2: x + w, y2: entryY },
          { x1: x, y1: targetY, x2: x + w, y2: targetY },
          { x1: x, y1: stopY, x2: x + w, y2: stopY },
        ],
        areas: [
          {
            x,
            y: Math.min(entryY, targetY),
            w,
            h: Math.abs(targetY - entryY),
            tone: 'profit',
          },
          { x, y: Math.min(entryY, stopY), w, h: Math.abs(stopY - entryY), tone: 'loss' },
        ],
        handles: pts,
      };
    }

    case 'text':
      return { segments: [], areas: [], handles: pts, label: a };
  }
}

/** Even-odd test, so a channel can be grabbed from anywhere inside it. */
export function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as { x: number; y: number };
    const b = poly[j] as { x: number; y: number };
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a line segment. */
export function distanceToSegment(px: number, py: number, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - s.x1, py - s.y1);
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

/** How close the pointer has to be, in CSS pixels, to grab something. */
export const HIT_TOLERANCE = 6;
export const HANDLE_RADIUS = 5;

export interface HitResult {
  /** Index into `drawing.points`, or -1 when the body was hit. */
  handle: number;
}

/**
 * Test a pointer position against a drawing.
 *
 * Handles win over the body, so grabbing an endpoint resizes rather than
 * dragging the whole shape.
 */
export function hitTestShape(shape: Shape, x: number, y: number): HitResult | null {
  for (let i = 0; i < shape.handles.length; i++) {
    const h = shape.handles[i] as { x: number; y: number };
    if (Math.hypot(x - h.x, y - h.y) <= HANDLE_RADIUS + HIT_TOLERANCE) return { handle: i };
  }
  for (const s of shape.segments) {
    if (distanceToSegment(x, y, s) <= HIT_TOLERANCE) return { handle: -1 };
  }
  // Filled areas count as part of the shape, so a rectangle can be dragged
  // from anywhere inside it rather than only by its edges.
  for (const area of shape.areas) {
    if (x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h) {
      return { handle: -1 };
    }
  }
  for (const poly of shape.polygons ?? []) {
    if (pointInPolygon(x, y, poly)) return { handle: -1 };
  }
  if (shape.label) {
    const { x: lx, y: ly } = shape.label;
    if (x >= lx - 4 && x <= lx + 160 && y >= ly - 12 && y <= ly + 12) return { handle: -1 };
  }
  return null;
}

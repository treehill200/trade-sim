import { newDrawingId } from '@/state/drawingsStore';
import type { Drawing, DrawingPoint, DrawingStyle, DrawingTool } from './types';

export type PlaceableTool = Exclude<DrawingTool, 'cursor'>;

/**
 * The tool being placed right now.
 *
 * `dragging` covers the rubber-band phase of a two-point tool and the stroke
 * of the brush. `awaitingOffset` is the parallel channel's second stage, where
 * the base line is fixed and the pointer sets how far the copy sits from it.
 */
export type Placement =
  | { kind: 'idle' }
  | { kind: 'dragging'; tool: PlaceableTool; points: DrawingPoint[] }
  | { kind: 'awaitingOffset'; tool: 'channel'; points: DrawingPoint[] };

/** Tools finished by a single click, with no drag. */
export function isSingleClick(tool: PlaceableTool): boolean {
  return tool === 'hline' || tool === 'hray' || tool === 'vline' || tool === 'text';
}

/** Points a tool starts with when the pointer first goes down. */
export function startPoints(tool: PlaceableTool, at: DrawingPoint): DrawingPoint[] {
  if (isSingleClick(tool)) return [at];
  if (tool === 'long' || tool === 'short') return [at, at, at];
  if (tool === 'channel') return [at, at, at];
  return [at, at];
}

/**
 * Update the in-progress points as the pointer moves.
 *
 * The position tools derive their stop from the entry and target, so a drag
 * produces a complete, sensible position in one gesture; the stop is then
 * adjustable by its own handle.
 */
export function dragPoints(
  tool: PlaceableTool,
  points: DrawingPoint[],
  at: DrawingPoint,
): DrawingPoint[] {
  const first = points[0];
  if (!first) return points;

  if (tool === 'brush') {
    const last = points[points.length - 1];
    // Drop points that are effectively on top of the previous one.
    if (last && Math.abs(last.time - at.time) < 1 && Math.abs(last.price - at.price) < 1) {
      return points;
    }
    return [...points, at];
  }

  if (tool === 'long' || tool === 'short') {
    const reward = at.price - first.price;
    // Default risk is half the reward, on the opposite side of the entry.
    const stopPrice = first.price - reward / 2;
    return [first, at, { time: at.time, price: stopPrice }];
  }

  if (tool === 'channel') {
    return [first, at, { time: at.time, price: at.price }];
  }

  return [first, at];
}

/** The channel's third point follows the pointer's price only. */
export function offsetPoints(points: DrawingPoint[], at: DrawingPoint): DrawingPoint[] {
  const first = points[0];
  const second = points[1];
  if (!first || !second) return points;
  return [first, second, { time: first.time, price: at.price }];
}

/** True when a drag has produced something big enough to be deliberate. */
export function isMeaningful(tool: PlaceableTool, points: DrawingPoint[], minTimeSpan: number): boolean {
  if (isSingleClick(tool)) return true;
  if (tool === 'brush') return points.length > 2;
  const a = points[0];
  const b = points[1];
  if (!a || !b) return false;
  if (tool === 'hline' || tool === 'hray') return true;
  return Math.abs(b.time - a.time) >= minTimeSpan || Math.abs(b.price - a.price) > 0;
}

export function makeDrawing(
  tool: PlaceableTool,
  points: DrawingPoint[],
  style: DrawingStyle,
  text?: string,
): Drawing {
  return {
    id: newDrawingId(),
    tool,
    points: points.map((p) => ({ ...p })),
    style: { ...style },
    ...(text === undefined ? {} : { text }),
    locked: false,
    visible: true,
  };
}

/** Move every point of a drawing by a time and price delta. */
export function translate(points: DrawingPoint[], dTime: number, dPrice: number): DrawingPoint[] {
  return points.map((p) => ({ time: p.time + dTime, price: p.price + dPrice }));
}

/**
 * Move one point of a drawing.
 *
 * A horizontal line has no meaningful time, and the position tools keep their
 * target and stop vertically aligned with each other, so those cases move more
 * than the single point the pointer grabbed.
 */
export function moveHandle(
  tool: PlaceableTool,
  points: DrawingPoint[],
  handle: number,
  at: DrawingPoint,
): DrawingPoint[] {
  const next = points.map((p) => ({ ...p }));
  const target = next[handle];
  if (!target) return points;
  target.time = at.time;
  target.price = at.price;

  if (tool === 'long' || tool === 'short') {
    const entry = next[0];
    const tgt = next[1];
    const stop = next[2];
    if (entry && tgt && stop) {
      if (handle === 0) {
        // Dragging the entry carries the whole position with it.
        const dPrice = at.price - (points[0] as DrawingPoint).price;
        const dTime = at.time - (points[0] as DrawingPoint).time;
        return translate(points, dTime, dPrice);
      }
      // Target and stop share the right-hand edge.
      const edge = handle === 1 ? tgt.time : stop.time;
      tgt.time = edge;
      stop.time = edge;
      if (handle === 1) tgt.price = at.price;
      else stop.price = at.price;
    }
  }

  if (tool === 'channel' && handle === 2) {
    const first = next[0];
    if (first) next[2] = { time: first.time, price: at.price };
  }

  return next;
}

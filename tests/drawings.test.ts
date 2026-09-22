import { beforeEach, describe, expect, it } from 'vitest';
import { CandleSeries } from '@/engine/series';
import { PriceScale, TimeScale } from '@/chart/scales';
import { DrawingMap, magnetPrice } from '@/drawings/mapping';
import {
  distanceToSegment,
  hitTestShape,
  pointInPolygon,
  resolveShape,
  type Bounds,
} from '@/drawings/geometry';
import {
  dragPoints,
  isMeaningful,
  isSingleClick,
  makeDrawing,
  moveHandle,
  offsetPoints,
  startPoints,
  translate,
} from '@/drawings/placement';
import { DEFAULT_STYLE, FIB_LEVELS, TOOL_LABELS, type Drawing } from '@/drawings/types';
import { resetDrawingHistory, useDrawings } from '@/state/drawingsStore';

const TF_MS = 60_000;
const T0 = Date.UTC(2025, 5, 1, 0, 0, 0);
const BOUNDS: Bounds = { width: 800, top: 0, height: 400 };

function makeSeries(n = 200): CandleSeries {
  const s = new CandleSeries();
  for (let i = 0; i < n; i++) {
    const open = 10_000 + i * 10;
    s.push(T0 + i * TF_MS, open, open + 60, open - 40, open + 20, 5);
  }
  return s;
}

function makeMap(series: CandleSeries): DrawingMap {
  const ts = new TimeScale();
  ts.width = BOUNDS.width;
  ts.barSpacing = 8;
  ts.rightIndex = series.length - 1;
  const ps = new PriceScale();
  ps.top = 0;
  ps.height = BOUNDS.height;
  ps.range = { min: 9_000, max: 13_000 };
  return new DrawingMap(series, TF_MS, ts, ps);
}

describe('drawing coordinate mapping', () => {
  const series = makeSeries();
  const map = makeMap(series);

  it('round-trips a timestamp through screen space', () => {
    const time = T0 + 50 * TF_MS;
    expect(map.timeOfX(map.xOfTime(time))).toBeCloseTo(time, 6);
  });

  it('round-trips a price through screen space', () => {
    expect(map.priceOfY(map.yOfPrice(11_234))).toBeCloseTo(11_234, 6);
  });

  it('maps times beyond the newest candle, so a ray can extend', () => {
    const future = T0 + 500 * TF_MS;
    expect(map.indexOfTime(future)).toBeGreaterThan(series.length - 1);
    expect(Number.isFinite(map.xOfTime(future))).toBe(true);
  });

  it('snaps a timestamp to the candle containing it', () => {
    const mid = T0 + 10 * TF_MS + 20_000;
    expect(map.snapTime(mid)).toBe(T0 + 10 * TF_MS);
  });

  it('is independent of the timeframe it was drawn on', () => {
    // The same instant maps to the same index fraction of the series, whatever
    // the candle size, which is what keeps drawings anchored.
    const hourly = new CandleSeries();
    for (let i = 0; i < 20; i++) hourly.push(T0 + i * 3_600_000, 1, 2, 0, 1, 1);
    const hourlyMap = new DrawingMap(hourly, 3_600_000, makeMap(series).timeScale, makeMap(series).priceScale);
    const time = T0 + 5 * 3_600_000;
    expect(hourlyMap.indexOfTime(time)).toBe(5);
  });
});

describe('magnet mode', () => {
  const series = makeSeries();
  const map = makeMap(series);

  it('snaps to whichever of the four prices is closest', () => {
    const index = 30;
    const time = T0 + index * TF_MS;
    const open = series.open[index] as number;
    const high = series.high[index] as number;
    const low = series.low[index] as number;
    expect(magnetPrice(series, map, time, open + 3)).toBe(open);
    expect(magnetPrice(series, map, time, high - 2)).toBe(high);
    expect(magnetPrice(series, map, time, low + 1)).toBe(low);
  });

  it('leaves prices alone outside the series', () => {
    const future = T0 + 5_000 * TF_MS;
    expect(magnetPrice(series, map, future, 12_345)).toBe(12_345);
  });
});

describe('shape resolution', () => {
  const series = makeSeries();
  const map = makeMap(series);

  const drawing = (tool: Drawing['tool'], prices: number[], indices: number[]): Drawing =>
    makeDrawing(
      tool,
      prices.map((price, i) => ({ time: T0 + (indices[i] as number) * TF_MS, price })),
      DEFAULT_STYLE,
    );

  it('a horizontal line spans the whole plot width', () => {
    const shape = resolveShape(drawing('hline', [11_000], [10]), map, BOUNDS);
    const s = shape.segments[0];
    expect(s?.x1).toBe(0);
    expect(s?.x2).toBe(BOUNDS.width);
    expect(s?.y1).toBeCloseTo(s?.y2 as number);
  });

  it('a horizontal ray starts at its anchor and runs right', () => {
    const d = drawing('hray', [11_000], [100]);
    const shape = resolveShape(d, map, BOUNDS);
    const s = shape.segments[0];
    expect(s?.x1).toBeCloseTo(map.xOfTime(d.points[0]!.time));
    expect(s?.x2).toBe(BOUNDS.width);
  });

  it('a ray leaves the plot area, an extended line leaves it both ways', () => {
    const ray = resolveShape(drawing('ray', [11_000, 11_500], [100, 120]), map, BOUNDS).segments[0];
    const ext = resolveShape(drawing('extended', [11_000, 11_500], [100, 120]), map, BOUNDS)
      .segments[0];
    const anchorX = map.xOfTime(T0 + 100 * TF_MS);
    // The ray still begins at its first point; the extended line runs past it.
    expect(ray?.x1).toBeCloseTo(anchorX);
    expect(ext?.x1).toBeLessThan(anchorX);
    expect(ext?.x2).toBeGreaterThan(anchorX);
  });

  it('a rectangle normalises whichever way it was dragged', () => {
    const forward = resolveShape(drawing('rect', [12_000, 11_000], [100, 140]), map, BOUNDS);
    const backward = resolveShape(drawing('rect', [11_000, 12_000], [140, 100]), map, BOUNDS);
    expect(forward.areas[0]?.x).toBeCloseTo(backward.areas[0]?.x as number);
    expect(forward.areas[0]?.y).toBeCloseTo(backward.areas[0]?.y as number);
    expect(forward.areas[0]?.w).toBeCloseTo(backward.areas[0]?.w as number);
    expect(forward.areas[0]?.h).toBeCloseTo(backward.areas[0]?.h as number);
  });

  it('a date range spans the pane vertically', () => {
    const shape = resolveShape(drawing('dateRange', [11_000, 12_000], [100, 130]), map, BOUNDS);
    expect(shape.areas[0]?.y).toBe(BOUNDS.top);
    expect(shape.areas[0]?.h).toBe(BOUNDS.height);
  });

  it('fib draws one line per level, at the right prices', () => {
    const d = drawing('fib', [12_000, 10_000], [100, 140]);
    const shape = resolveShape(d, map, BOUNDS);
    expect(shape.segments).toHaveLength(FIB_LEVELS.length);
    FIB_LEVELS.forEach((level, i) => {
      const expected = 12_000 + (10_000 - 12_000) * level;
      expect(shape.segments[i]?.y1).toBeCloseTo(map.yOfPrice(expected), 6);
    });
  });

  it('a position tool marks a profit zone and a loss zone', () => {
    const shape = resolveShape(drawing('long', [11_000, 12_000, 10_500], [100, 130, 130]), map, BOUNDS);
    expect(shape.areas.map((a) => a.tone)).toEqual(['profit', 'loss']);
  });

  it('a channel is a filled parallelogram', () => {
    const shape = resolveShape(drawing('channel', [11_000, 11_800, 11_400], [100, 140, 100]), map, BOUNDS);
    expect(shape.segments).toHaveLength(2);
    expect(shape.polygons?.[0]).toHaveLength(4);
  });

  it('an incomplete drawing resolves to nothing rather than throwing', () => {
    const half = makeDrawing('trendline', [{ time: T0, price: 11_000 }], DEFAULT_STYLE);
    expect(resolveShape(half, map, BOUNDS).segments).toHaveLength(0);
  });

  it('every tool resolves without error', () => {
    for (const tool of Object.keys(TOOL_LABELS) as Drawing['tool'][]) {
      const points = startPoints(tool, { time: T0 + 100 * TF_MS, price: 11_000 }).map((p, i) => ({
        time: p.time + i * 10 * TF_MS,
        price: p.price + i * 200,
      }));
      expect(() => resolveShape(makeDrawing(tool, points, DEFAULT_STYLE), map, BOUNDS)).not.toThrow();
    }
  });
});

describe('hit testing', () => {
  const series = makeSeries();
  const map = makeMap(series);

  it('measures distance to a segment, including past its ends', () => {
    const seg = { x1: 0, y1: 0, x2: 10, y2: 0 };
    expect(distanceToSegment(5, 3, seg)).toBeCloseTo(3);
    expect(distanceToSegment(-4, 0, seg)).toBeCloseTo(4);
    expect(distanceToSegment(14, 0, seg)).toBeCloseTo(4);
  });

  it('finds points inside a polygon', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon(5, 5, poly)).toBe(true);
    expect(pointInPolygon(15, 5, poly)).toBe(false);
  });

  it('prefers a handle over the body, so an endpoint resizes', () => {
    const d = makeDrawing(
      'trendline',
      [
        { time: T0 + 100 * TF_MS, price: 11_000 },
        { time: T0 + 140 * TF_MS, price: 11_800 },
      ],
      DEFAULT_STYLE,
    );
    const shape = resolveShape(d, map, BOUNDS);
    const end = shape.handles[1]!;
    expect(hitTestShape(shape, end.x, end.y)?.handle).toBe(1);
    const mid = {
      x: (shape.handles[0]!.x + end.x) / 2,
      y: (shape.handles[0]!.y + end.y) / 2,
    };
    expect(hitTestShape(shape, mid.x, mid.y)?.handle).toBe(-1);
  });

  it('misses when the pointer is nowhere near', () => {
    const d = makeDrawing(
      'trendline',
      [
        { time: T0 + 100 * TF_MS, price: 11_000 },
        { time: T0 + 140 * TF_MS, price: 11_000 },
      ],
      DEFAULT_STYLE,
    );
    const shape = resolveShape(d, map, BOUNDS);
    expect(hitTestShape(shape, shape.handles[0]!.x, shape.handles[0]!.y + 80)).toBeNull();
  });

  it('a filled rectangle can be grabbed from inside', () => {
    const d = makeDrawing(
      'rect',
      [
        { time: T0 + 100 * TF_MS, price: 12_000 },
        { time: T0 + 140 * TF_MS, price: 11_000 },
      ],
      DEFAULT_STYLE,
    );
    const shape = resolveShape(d, map, BOUNDS);
    const area = shape.areas[0]!;
    expect(hitTestShape(shape, area.x + area.w / 2, area.y + area.h / 2)?.handle).toBe(-1);
  });
});

describe('placement', () => {
  const at = (index: number, price: number) => ({ time: T0 + index * TF_MS, price });

  it('knows which tools finish on a single click', () => {
    expect(isSingleClick('hline')).toBe(true);
    expect(isSingleClick('text')).toBe(true);
    expect(isSingleClick('trendline')).toBe(false);
  });

  it('a position tool derives a stop on the other side of the entry', () => {
    const points = dragPoints('long', startPoints('long', at(0, 10_000)), at(20, 11_000));
    expect(points[0]?.price).toBe(10_000);
    expect(points[1]?.price).toBe(11_000);
    // Risk defaults to half the reward, below the entry for a long.
    expect(points[2]?.price).toBe(9_500);
  });

  it('a brush drops points that land on the previous one', () => {
    let points = startPoints('brush', at(0, 10_000));
    points = dragPoints('brush', points, at(0, 10_000));
    expect(points).toHaveLength(2);
    points = dragPoints('brush', points, at(1, 10_100));
    expect(points).toHaveLength(3);
  });

  it("a channel's offset point tracks price only", () => {
    const base = [at(0, 10_000), at(20, 11_000), at(20, 11_000)];
    const next = offsetPoints(base, at(35, 10_400));
    expect(next[2]?.price).toBe(10_400);
    expect(next[2]?.time).toBe(base[0]?.time);
  });

  it('rejects a drag too small to be deliberate', () => {
    const tiny = [at(10, 10_000), at(10, 10_000)];
    expect(isMeaningful('trendline', tiny, TF_MS)).toBe(false);
    expect(isMeaningful('trendline', [at(10, 10_000), at(12, 10_000)], TF_MS)).toBe(true);
    expect(isMeaningful('hline', [at(10, 10_000)], TF_MS)).toBe(true);
  });

  it('translating moves every point by the same delta', () => {
    const moved = translate([at(0, 10_000), at(10, 11_000)], 5 * TF_MS, -500);
    expect(moved[0]).toEqual(at(5, 9_500));
    expect(moved[1]).toEqual(at(15, 10_500));
  });

  it('dragging a position entry carries the target and stop with it', () => {
    const points = [at(0, 10_000), at(20, 11_000), at(20, 9_500)];
    const moved = moveHandle('long', points, 0, at(4, 10_400));
    expect(moved[1]?.price).toBe(11_400);
    expect(moved[2]?.price).toBe(9_900);
  });

  it('dragging a target keeps the right-hand edge shared with the stop', () => {
    const points = [at(0, 10_000), at(20, 11_000), at(20, 9_500)];
    const moved = moveHandle('long', points, 1, at(40, 12_000));
    expect(moved[1]?.price).toBe(12_000);
    expect(moved[1]?.time).toBe(moved[2]?.time);
    expect(moved[2]?.price).toBe(9_500);
  });
});

describe('drawings store', () => {
  beforeEach(() => {
    resetDrawingHistory();
    useDrawings.setState({ drawings: [], selectedId: null, tool: 'cursor' });
  });

  const sample = (price = 10_000): Drawing =>
    makeDrawing('hline', [{ time: T0, price }], DEFAULT_STYLE);

  it('adds, selects and removes', () => {
    const d = sample();
    useDrawings.getState().add(d);
    expect(useDrawings.getState().drawings).toHaveLength(1);
    expect(useDrawings.getState().selectedId).toBe(d.id);
    useDrawings.getState().remove(d.id);
    expect(useDrawings.getState().drawings).toHaveLength(0);
    expect(useDrawings.getState().selectedId).toBeNull();
  });

  it('undoes and redoes an add', () => {
    useDrawings.getState().add(sample());
    expect(useDrawings.getState().canUndo()).toBe(true);
    useDrawings.getState().undo();
    expect(useDrawings.getState().drawings).toHaveLength(0);
    useDrawings.getState().redo();
    expect(useDrawings.getState().drawings).toHaveLength(1);
  });

  it('treats a whole drag as one undo step', () => {
    const d = sample();
    useDrawings.getState().add(d);
    // Many moves, as a real drag produces, then one commit.
    for (let i = 1; i <= 10; i++) {
      useDrawings.getState().moveLive(d.id, [{ time: T0, price: 10_000 + i * 100 }]);
    }
    useDrawings.getState().commit();
    expect(useDrawings.getState().drawings[0]?.points[0]?.price).toBe(11_000);
    useDrawings.getState().undo();
    expect(useDrawings.getState().drawings[0]?.points[0]?.price).toBe(10_000);
  });

  it('a new change clears the redo stack', () => {
    useDrawings.getState().add(sample(10_000));
    useDrawings.getState().undo();
    expect(useDrawings.getState().canRedo()).toBe(true);
    useDrawings.getState().add(sample(20_000));
    expect(useDrawings.getState().canRedo()).toBe(false);
  });

  it('clones a drawing to a new id, offset so it is visible', () => {
    const d = sample();
    useDrawings.getState().add(d);
    useDrawings.getState().clone(d.id);
    const all = useDrawings.getState().drawings;
    expect(all).toHaveLength(2);
    expect(all[1]?.id).not.toBe(all[0]?.id);
    expect(all[1]?.points[0]?.price).not.toBe(all[0]?.points[0]?.price);
  });

  it('removes everything in one undoable step', () => {
    useDrawings.getState().add(sample(1));
    useDrawings.getState().add(sample(2));
    useDrawings.getState().removeAll();
    expect(useDrawings.getState().drawings).toHaveLength(0);
    useDrawings.getState().undo();
    expect(useDrawings.getState().drawings).toHaveLength(2);
  });

  it('restyling the selection changes only that drawing', () => {
    const a = sample(1);
    const b = sample(2);
    useDrawings.getState().add(a);
    useDrawings.getState().add(b);
    useDrawings.getState().select(a.id);
    useDrawings.getState().setStyle({ color: '#ff0000' });
    const all = useDrawings.getState().drawings;
    expect(all.find((d) => d.id === a.id)?.style.color).toBe('#ff0000');
    expect(all.find((d) => d.id === b.id)?.style.color).toBe(DEFAULT_STYLE.color);
  });

  it('selecting a tool clears the selection, so the next click draws', () => {
    const d = sample();
    useDrawings.getState().add(d);
    expect(useDrawings.getState().selectedId).toBe(d.id);
    useDrawings.getState().setTool('trendline');
    expect(useDrawings.getState().selectedId).toBeNull();
  });
});

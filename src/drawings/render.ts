import type { ChartTheme } from '@/chart/theme';
import { formatCents, formatPercent, formatSignedCents } from '@/chart/format';
import type { DrawingMap } from './mapping';
import { resolveShape, type Area, type Bounds, type Shape, HANDLE_RADIUS } from './geometry';
import { FIB_LEVELS, dashPattern, type Drawing } from './types';

export interface DrawingRenderInput {
  drawings: Drawing[];
  /** The drawing being placed right now, rendered but not yet committed. */
  preview: Drawing | null;
  map: DrawingMap;
  bounds: Bounds;
  theme: ChartTheme;
  dpr: number;
  selectedId: string | null;
  hidden: boolean;
}

export function drawDrawings(ctx: CanvasRenderingContext2D, input: DrawingRenderInput): void {
  const { drawings, preview, bounds, hidden } = input;
  if (hidden && !preview) return;

  ctx.save();
  // Everything is clipped to the price pane so a ray cannot run over the
  // indicator panes or the axes.
  ctx.beginPath();
  ctx.rect(0, bounds.top, bounds.width, bounds.height);
  ctx.clip();

  if (!hidden) {
    for (const d of drawings) {
      if (!d.visible) continue;
      drawOne(ctx, d, input, d.id === input.selectedId);
    }
  }
  if (preview) drawOne(ctx, preview, input, false);

  ctx.restore();
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  drawing: Drawing,
  input: DrawingRenderInput,
  selected: boolean,
): void {
  const { map, bounds, theme, dpr } = input;
  const shape = resolveShape(drawing, map, bounds);

  fillAreas(ctx, drawing, shape, theme);

  ctx.save();
  ctx.setLineDash(dashPattern(drawing.style.dash, dpr));
  ctx.strokeStyle = drawing.style.color;
  ctx.lineWidth = drawing.style.width;
  ctx.lineCap = drawing.tool === 'brush' ? 'round' : 'butt';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const s of shape.segments) {
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
  }
  ctx.stroke();
  ctx.restore();

  drawDecorations(ctx, drawing, shape, input);

  if (selected && !drawing.locked) drawHandles(ctx, shape, theme);
}

function fillAreas(
  ctx: CanvasRenderingContext2D,
  drawing: Drawing,
  shape: Shape,
  theme: ChartTheme,
): void {
  for (const poly of shape.polygons ?? []) {
    if (poly.length < 3) continue;
    ctx.save();
    ctx.fillStyle = drawing.style.fill;
    ctx.beginPath();
    ctx.moveTo((poly[0] as { x: number; y: number }).x, (poly[0] as { x: number; y: number }).y);
    for (let i = 1; i < poly.length; i++) {
      const p = poly[i] as { x: number; y: number };
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  if (shape.areas.length === 0) return;
  ctx.save();
  shape.areas.forEach((area: Area, i) => {
    if (area.tone === 'profit') ctx.fillStyle = withAlpha(theme.up, 0.16);
    else if (area.tone === 'loss') ctx.fillStyle = withAlpha(theme.down, 0.16);
    else if (drawing.tool === 'fib') {
      // Alternate bands so neighbouring levels stay distinguishable.
      ctx.fillStyle = withAlpha(drawing.style.color, i % 2 === 0 ? 0.1 : 0.04);
    } else ctx.fillStyle = drawing.style.fill;
    ctx.fillRect(area.x, area.y, area.w, area.h);
  });
  ctx.restore();
}

function drawDecorations(
  ctx: CanvasRenderingContext2D,
  drawing: Drawing,
  shape: Shape,
  input: DrawingRenderInput,
): void {
  const { map, theme, bounds } = input;
  const pts = drawing.points;

  switch (drawing.tool) {
    case 'arrow': {
      const s = shape.segments[0];
      if (s) drawArrowHead(ctx, s.x1, s.y1, s.x2, s.y2, drawing.style.color, drawing.style.width);
      break;
    }

    case 'text': {
      const at = shape.label;
      if (!at) break;
      ctx.save();
      ctx.font = `500 ${drawing.style.fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = drawing.style.color;
      ctx.fillText(drawing.text ?? 'Text', at.x + 4, at.y);
      ctx.restore();
      break;
    }

    case 'fib': {
      const a = pts[0];
      const b = pts[1];
      if (!a || !b) break;
      ctx.save();
      ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = theme.textMuted;
      const x = Math.min(map.xOfTime(a.time), map.xOfTime(b.time));
      FIB_LEVELS.forEach((level) => {
        const price = a.price + (b.price - a.price) * level;
        const y = map.yOfPrice(price);
        ctx.fillText(`${level.toFixed(3)}  ${formatCents(Math.round(price))}`, x + 5, y - 7);
      });
      ctx.restore();
      break;
    }

    case 'priceRange': {
      const a = pts[0];
      const b = pts[1];
      if (!a || !b) break;
      const change = b.price - a.price;
      const pct = a.price !== 0 ? change / a.price : 0;
      const area = shape.areas[0];
      if (!area) break;
      label(
        ctx,
        theme,
        `${formatSignedCents(change)}  (${formatPercent(pct)})`,
        area.x + area.w / 2,
        area.y + area.h / 2,
        change >= 0 ? theme.up : theme.down,
      );
      break;
    }

    case 'dateRange': {
      const a = pts[0];
      const b = pts[1];
      if (!a || !b) break;
      const bars = Math.abs(Math.round(map.indexOfTime(b.time) - map.indexOfTime(a.time)));
      const area = shape.areas[0];
      if (!area) break;
      // Along the bottom edge, where it cannot collide with the OHLC legend.
      label(
        ctx,
        theme,
        `${bars} bars  ${formatDuration(Math.abs(b.time - a.time))}`,
        area.x + area.w / 2,
        bounds.top + bounds.height - 14,
        theme.accent,
      );
      break;
    }

    case 'long':
    case 'short': {
      const entry = pts[0];
      const target = pts[1];
      const stop = pts[2];
      if (!entry || !target || !stop) break;
      const reward = Math.abs(target.price - entry.price);
      const risk = Math.abs(stop.price - entry.price);
      const ratio = risk > 0 ? reward / risk : 0;
      const area = shape.areas[0];
      const lossArea = shape.areas[1];
      if (area) {
        label(
          ctx,
          theme,
          `Target ${formatCents(Math.round(target.price))}  +${formatCents(Math.round(reward))}`,
          area.x + area.w / 2,
          area.y + area.h / 2,
          theme.up,
        );
      }
      if (lossArea) {
        label(
          ctx,
          theme,
          `Stop ${formatCents(Math.round(stop.price))}  -${formatCents(Math.round(risk))}`,
          lossArea.x + lossArea.w / 2,
          lossArea.y + lossArea.h / 2,
          theme.down,
        );
      }
      const entryY = map.yOfPrice(entry.price);
      label(
        ctx,
        theme,
        `${drawing.tool === 'long' ? 'Long' : 'Short'}  R:R ${ratio.toFixed(2)}`,
        (area?.x ?? 0) + 4,
        entryY - 12,
        theme.text,
        'left',
      );
      break;
    }

    default:
      break;
  }
}

function drawHandles(ctx: CanvasRenderingContext2D, shape: Shape, theme: ChartTheme): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = theme.accent;
  ctx.fillStyle = theme.background;
  for (const h of shape.handles) {
    ctx.beginPath();
    ctx.arc(h.x, h.y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.max(9, width * 4);
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 7), y2 - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 7), y2 - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A small pill of text, readable over candles either way up. */
function label(
  ctx: CanvasRenderingContext2D,
  theme: ChartTheme,
  text: string,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign = 'center',
): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12;
  const boxX = align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = withAlpha(theme.panelBackground, 0.9);
  ctx.fillRect(boxX, y - 9, w, 18);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, boxX + 6, y);
  ctx.restore();
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days}d` : `${days}d ${remHours}h`;
}

/** Re-express a colour at a given alpha; hex and rgb/rgba inputs both work. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((ch) => ch + ch)
            .join('')
        : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const m = color.match(/rgba?\(([^)]+)\)/i);
  if (!m) return color;
  const parts = (m[1] as string).split(',').map((v) => v.trim());
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
}

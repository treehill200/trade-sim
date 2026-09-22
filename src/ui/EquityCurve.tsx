import { useEffect, useRef, useState } from 'react';
import { themeByName } from '@/chart/theme';
import { useUi } from '@/state/store';
import { centsToDollars, type Cents } from '@/trading/money';

/**
 * The equity curve, drawn on its own small canvas.
 *
 * Its own canvas rather than a pane on the main chart: the x axis here is
 * trade number, not time, so it does not belong on a price chart at all.
 */
export function EquityCurve({ points }: { points: Cents[] }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const themeName = useUi((s) => s.theme);
  const [size, setSize] = useState(0);

  // The account panel is resizable, so re-measure rather than trusting mount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setSize((n) => n + 1));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const theme = themeByName(themeName);
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (points.length < 2) {
      ctx.fillStyle = theme.textMuted;
      ctx.font = '400 11.5px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Close a trade to start the curve', width / 2, height / 2);
      return;
    }

    const pad = 8;
    const start = points[0] as number;
    let min = Math.min(...points);
    let max = Math.max(...points);
    if (min === max) {
      min -= 100;
      max += 100;
    }
    const span = max - min;
    const x = (i: number): number => pad + (i / (points.length - 1)) * (width - pad * 2);
    const y = (v: number): number =>
      height - pad - ((v - min) / span) * (height - pad * 2);

    // The starting balance, so profit and loss read against it at a glance.
    ctx.strokeStyle = theme.gridStrong;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y(start));
    ctx.lineTo(width - pad, y(start));
    ctx.stroke();
    ctx.setLineDash([]);

    const end = points[points.length - 1] as number;
    const up = end >= start;
    const color = up ? theme.up : theme.down;

    // Fill down to the starting line, so the shaded area is the profit.
    const fill = new Path2D();
    fill.moveTo(x(0), y(start));
    points.forEach((v, i) => fill.lineTo(x(i), y(v)));
    fill.lineTo(x(points.length - 1), y(start));
    fill.closePath();
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, up ? theme.upFill : theme.downFill);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = gradient;
    ctx.fill(fill);
    ctx.restore();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((v, i) => {
      if (i === 0) ctx.moveTo(x(i), y(v));
      else ctx.lineTo(x(i), y(v));
    });
    ctx.stroke();

    // Label the ends, which is all the axis anyone needs here.
    ctx.fillStyle = theme.textMuted;
    ctx.font = '400 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(centsToDollars(min).toFixed(0), pad, height - pad + 1);
    ctx.textAlign = 'right';
    ctx.fillText(centsToDollars(max).toFixed(0), width - pad, pad - 1);
  }, [points, themeName, size]);

  return (
    <div className="equity-curve" ref={containerRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}

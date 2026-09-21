import { TF_SECONDS, type Timeframe } from '@/engine/timeframes';

/** Format integer cents as a plain dollar amount, e.g. 4012345 -> "40,123.45". */
export function formatCents(cents: number, decimals = 2): string {
  const v = cents / 100;
  return v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatSignedCents(cents: number, decimals = 2): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
  return sign + formatCents(Math.abs(cents), decimals);
}

export function formatPercent(fraction: number, decimals = 2): string {
  const sign = fraction > 0 ? '+' : fraction < 0 ? '-' : '';
  return `${sign}${(Math.abs(fraction) * 100).toFixed(decimals)}%`;
}

export function formatVolume(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(3);
}

/** Zero-padded mm:ss, used for the countdown to candle close. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export interface TimeFormatOptions {
  timeZone: string;
}

/**
 * Intl formatters are expensive to construct — building one per label turned
 * the time axis into the slowest thing on the frame — so they are cached per
 * time zone and reused.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      // An unknown zone (stale saved setting, odd browser) falls back to UTC.
      fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

const partsCache = new Map<string, Record<string, string>>();

function parts(ms: number, timeZone: string): Record<string, string> {
  const key = `${timeZone}|${ms}`;
  const hit = partsCache.get(key);
  if (hit) return hit;
  const out: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) out[p.type] = p.value;
  // The same handful of timestamps are formatted every frame; a bounded cache
  // keeps that free without growing without limit as the chart scrolls.
  if (partsCache.size > 512) partsCache.clear();
  partsCache.set(key, out);
  return out;
}

/** Axis label for a candle, at the level of detail the timeframe needs. */
export function formatAxisTime(ms: number, tf: Timeframe, timeZone: string, withDate: boolean): string {
  const p = parts(ms, timeZone);
  if (withDate) {
    return TF_SECONDS[tf] >= 86400 ? `${p['month']} ${p['year']}` : `${p['day']} ${p['month']}`;
  }
  if (TF_SECONDS[tf] < 60) return `${p['hour']}:${p['minute']}:${p['second']}`;
  return `${p['hour']}:${p['minute']}`;
}

/** Full timestamp for the crosshair label. */
export function formatFullTime(ms: number, tf: Timeframe, timeZone: string): string {
  const p = parts(ms, timeZone);
  const date = `${p['day']} ${p['month']} '${(p['year'] ?? '').slice(2)}`;
  const time = TF_SECONDS[tf] < 60 ? `${p['hour']}:${p['minute']}:${p['second']}` : `${p['hour']}:${p['minute']}`;
  return `${date}  ${time}`;
}

export function formatClock(ms: number, timeZone: string): string {
  const p = parts(ms, timeZone);
  return `${p['hour']}:${p['minute']}:${p['second']}`;
}

/** True when `a` and `b` fall on different calendar days in `timeZone`. */
export function isNewDay(a: number, b: number, timeZone: string): boolean {
  const pa = parts(a, timeZone);
  const pb = parts(b, timeZone);
  return pa['day'] !== pb['day'] || pa['month'] !== pb['month'] || pa['year'] !== pb['year'];
}

/**
 * Pick a "nice" step for a price axis: 1, 2, 2.5 or 5 times a power of ten,
 * never finer than the tick size.
 */
export function niceStep(rawStep: number, minStep: number): number {
  const step = Math.max(rawStep, minStep);
  const exp = Math.floor(Math.log10(step));
  const pow = Math.pow(10, exp);
  const norm = step / pow;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return Math.max(mult * pow, minStep);
}

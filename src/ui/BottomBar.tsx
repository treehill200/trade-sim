import { useUi } from '@/state/store';
import { marketClient } from '@/state/marketClient';
import { formatCents, formatClock } from '@/chart/format';
import { useMarketPulse, useNow } from './useMarket';
import { DateRangeButtons } from './DateRangeButtons';

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
];

function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function BottomBar(): JSX.Element {
  useMarketPulse(3);
  const now = useNow(1000);
  const { timeZone, setTimeZone } = useUi();
  const q = marketClient.quote;

  const zones = TIMEZONES.includes(localZone()) ? TIMEZONES : [localZone(), ...TIMEZONES];

  return (
    <footer className="bottom-bar">
      <div className="bottom-left">
        <DateRangeButtons />
        <span className="bottom-divider" />
        <span className="quote-chip">
          <em>Bid</em>
          <b className="down">{q.bid ? formatCents(q.bid) : '—'}</b>
        </span>
        <span className="quote-chip">
          <em>Ask</em>
          <b className="up">{q.ask ? formatCents(q.ask) : '—'}</b>
        </span>
        <span className="quote-chip">
          <em>Spread</em>
          <b>{q.spread ? formatCents(q.spread) : '—'}</b>
        </span>
      </div>
      <div className="bottom-right">
        <span className="clock">{formatClock(now, timeZone)}</span>
        <select
          className="tz-select"
          value={timeZone}
          onChange={(e) => setTimeZone(e.target.value)}
          aria-label="Time zone"
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>
    </footer>
  );
}

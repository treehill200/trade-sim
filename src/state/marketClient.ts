import { CandleSeries } from '@/engine/series';
import type { Timeframe } from '@/engine/timeframes';
import type { MarketConfig } from '@/engine/config';
import type { Quote } from '@/engine/world';
import type { OrderBook } from '@/engine/orderbook';
import type { FromWorker, ToWorker } from '@/workers/protocol';

export type MarketPhase = 'idle' | 'loading' | 'backfill' | 'catchup' | 'ready' | 'error';

export interface MarketStatus {
  phase: MarketPhase;
  done: number;
  total: number;
  message?: string;
}

type StatusListener = (s: MarketStatus) => void;
type DataListener = () => void;

const EMPTY_BOOK: OrderBook = { bids: [], asks: [], bid: 0, ask: 0, spread: 0 };

/**
 * Main-thread face of the market worker.
 *
 * The candle data for the active timeframe lives here as a mutable
 * `CandleSeries`; React never re-renders because a price moved. Components
 * that need numbers (the header, the legend) subscribe to `onData` and pull,
 * and the chart simply reads the arrays inside its own animation frame.
 */
class MarketClient {
  private worker: Worker | null = null;
  series = new CandleSeries(4096);
  quote: Quote = { time: 0, last: 0, bid: 0, ask: 0, spread: 0, volFactor: 1 };
  book: OrderBook = EMPTY_BOOK;
  config: MarketConfig | null = null;
  timeframe: Timeframe = '1m';
  status: MarketStatus = { phase: 'idle', done: 0, total: 1 };
  /** Bumped whenever the series is structurally replaced (timeframe switch). */
  revision = 0;

  private statusListeners = new Set<StatusListener>();
  private dataListeners = new Set<DataListener>();

  start(timeframe: Timeframe): void {
    if (this.worker) return;
    this.timeframe = timeframe;
    this.worker = new Worker(new URL('../workers/market.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data);
    this.worker.onerror = (ev) => {
      this.setStatus({ phase: 'error', done: 0, total: 1, message: ev.message });
    };
    this.send({ type: 'start' });
    this.send({ type: 'subscribe', tf: timeframe });
  }

  private send(msg: ToWorker): void {
    this.worker?.postMessage(msg);
  }

  setTimeframe(tf: Timeframe): void {
    if (tf === this.timeframe) return;
    this.timeframe = tf;
    this.send({ type: 'subscribe', tf });
  }

  setBookLevels(levels: number): void {
    this.send({ type: 'setBookLevels', levels });
  }

  reset(): void {
    this.series = new CandleSeries(4096);
    this.revision += 1;
    this.send({ type: 'reset' });
  }

  flush(): void {
    this.send({ type: 'flush' });
  }

  private handle(msg: FromWorker): void {
    switch (msg.type) {
      case 'progress':
        this.setStatus({ phase: msg.phase, done: msg.done, total: msg.total });
        break;
      case 'ready':
        this.config = msg.config;
        this.quote = msg.quote;
        this.book = msg.book;
        if (msg.tf === this.timeframe) {
          this.series = CandleSeries.fromSnapshot(msg.snapshot);
          this.revision += 1;
        }
        this.setStatus({ phase: 'ready', done: 1, total: 1 });
        this.emitData();
        break;
      case 'snapshot':
        this.quote = msg.quote;
        if (msg.tf === this.timeframe) {
          this.series = CandleSeries.fromSnapshot(msg.snapshot);
          this.revision += 1;
        }
        this.emitData();
        break;
      case 'tick': {
        this.quote = msg.quote;
        this.book = msg.book;
        if (msg.live.tf === this.timeframe) {
          const s = this.series;
          const i = s.length - 1;
          if (i >= 0 && s.time[i] === msg.live.time) {
            s.setLast(msg.live.open, msg.live.high, msg.live.low, msg.live.close, msg.live.volume);
          } else if (i < 0 || (s.time[i] as number) < msg.live.time) {
            s.push(
              msg.live.time,
              msg.live.open,
              msg.live.high,
              msg.live.low,
              msg.live.close,
              msg.live.volume,
            );
          }
        }
        this.emitData();
        break;
      }
      case 'error':
        this.setStatus({ phase: 'error', done: 0, total: 1, message: msg.message });
        break;
    }
  }

  private setStatus(s: MarketStatus): void {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  private emitData(): void {
    for (const l of this.dataListeners) l();
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onData(fn: DataListener): () => void {
    this.dataListeners.add(fn);
    return () => this.dataListeners.delete(fn);
  }
}

export const marketClient = new MarketClient();

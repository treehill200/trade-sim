import type { SeriesSnapshot } from '@/engine/series';
import type { Timeframe } from '@/engine/timeframes';
import type { MarketConfig } from '@/engine/config';
import type { Quote } from '@/engine/world';
import type { OrderBook } from '@/engine/orderbook';

/** A single candle sent as a live update for the subscribed timeframe. */
export interface LiveCandle {
  tf: Timeframe;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ToWorker =
  | { type: 'start'; seedText?: string }
  | { type: 'subscribe'; tf: Timeframe }
  | { type: 'setBookLevels'; levels: number }
  | { type: 'reset' }
  | { type: 'flush' };

export type FromWorker =
  | { type: 'progress'; phase: 'loading' | 'backfill' | 'catchup'; done: number; total: number }
  | {
      type: 'ready';
      config: MarketConfig;
      tf: Timeframe;
      snapshot: SeriesSnapshot;
      quote: Quote;
      book: OrderBook;
    }
  | { type: 'snapshot'; tf: Timeframe; snapshot: SeriesSnapshot; quote: Quote }
  | { type: 'tick'; quote: Quote; live: LiveCandle; book: OrderBook }
  | { type: 'error'; message: string };

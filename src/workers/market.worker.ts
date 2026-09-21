/// <reference lib="webworker" />
import { World } from '@/engine/world';
import { SeriesSet } from '@/engine/seriesSet';
import { ENGINE_VERSION, makeDefaultConfig, type MarketConfig } from '@/engine/config';
import type { SimState } from '@/engine/simulator';
import type { SeriesSnapshot } from '@/engine/series';
import { TIMEFRAMES, type Timeframe } from '@/engine/timeframes';
import { idbGet, idbPutMany, idbClearAll, STORE_META, STORE_SERIES } from '@/storage/idb';
import type { FromWorker, ToWorker } from './protocol';

/**
 * The market runs entirely on this worker.
 *
 * Backfilling 30 days means stepping millions of simulated seconds; doing that
 * on the main thread would freeze the page. Keeping the engine here also means
 * the live tick loop can never compete with rendering for frame time.
 */

const CHUNK_SECONDS = 120_000; // simulated seconds per slice of work
const SAVE_INTERVAL_MS = 30_000;
const TICK_INTERVAL_MS = 1000 / 8; // poll at 8Hz; prints land at 4Hz

let world: World | null = null;
let activeTf: Timeframe = '1m';
let bookLevels = 14;
let lastSave = 0;
let tickTimer: ReturnType<typeof setInterval> | null = null;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

function snapshotTransferables(s: SeriesSnapshot): Transferable[] {
  return [s.time.buffer, s.open.buffer, s.high.buffer, s.low.buffer, s.close.buffer, s.volume.buffer];
}

async function loadPersisted(): Promise<{
  config: MarketConfig | null;
  state: SimState | null;
  series: SeriesSet | null;
}> {
  const version = await idbGet<number>(STORE_META, 'engineVersion');
  if (version !== ENGINE_VERSION) {
    // The simulator changed shape since this was written; start clean.
    await idbClearAll();
    return { config: null, state: null, series: null };
  }
  const config = await idbGet<MarketConfig>(STORE_META, 'config');
  const state = await idbGet<SimState>(STORE_META, 'checkpoint');
  if (!config || !state) return { config, state: null, series: null };

  const snaps = {} as Record<Timeframe, SeriesSnapshot>;
  let any = false;
  for (const tf of TIMEFRAMES) {
    const snap = await idbGet<SeriesSnapshot>(STORE_SERIES, tf);
    if (snap && snap.time instanceof Float64Array) {
      snaps[tf] = snap;
      any = true;
    }
  }
  if (!any) return { config, state: null, series: null };
  return { config, state, series: SeriesSet.fromSnapshots(snaps) };
}

async function persist(): Promise<void> {
  if (!world) return;
  lastSave = Date.now();
  const snaps = world.series.snapshotAll();
  await idbPutMany(STORE_META, [
    ['engineVersion', ENGINE_VERSION],
    ['config', world.config],
    ['checkpoint', world.checkpoint()],
  ]);
  await idbPutMany(
    STORE_SERIES,
    TIMEFRAMES.map((tf) => [tf, snaps[tf]] as [string, unknown]),
  );
}

/** Yield to the event loop so progress messages actually get delivered. */
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function start(seedText?: string): Promise<void> {
  post({ type: 'progress', phase: 'loading', done: 0, total: 1 });

  const now = Date.now();
  const persisted = await loadPersisted();
  const config = persisted.config ?? makeDefaultConfig(now, seedText ?? 'david-coin');

  if (persisted.state && persisted.series) {
    world = new World(config, { state: persisted.state, series: persisted.series });
    world.resetSecondSeriesIfStale(now);
  } else {
    world = new World(config);
  }

  const total = Math.max(1, world.secondsBehind(now));
  const phase = persisted.state ? 'catchup' : 'backfill';
  let done = 0;
  post({ type: 'progress', phase, done: 0, total });

  while (!world.isCaughtUp(Date.now())) {
    const produced = world.catchUpChunk(Date.now(), CHUNK_SECONDS);
    if (produced === 0) break;
    done += produced;
    post({ type: 'progress', phase, done: Math.min(done, total), total });
    await yieldToLoop();
  }

  await persist();

  const snapshot = world.series.get(activeTf).snapshot();
  post(
    {
      type: 'ready',
      config,
      tf: activeTf,
      snapshot,
      quote: world.quote,
      book: world.book(bookLevels),
    },
    snapshotTransferables(snapshot),
  );

  startTicking();
}

function liveCandleFor(tf: Timeframe) {
  const s = world!.series.get(tf);
  const i = s.length - 1;
  return {
    tf,
    time: s.time[i] as number,
    open: s.open[i] as number,
    high: s.high[i] as number,
    low: s.low[i] as number,
    close: s.close[i] as number,
    volume: s.volume[i] as number,
  };
}

function startTicking(): void {
  if (tickTimer !== null) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (!world) return;
    const now = Date.now();
    // A long sleep (laptop lid closed) can leave the world minutes behind;
    // walk it forward in bulk before resuming sub-second prints.
    if (world.secondsBehind(now) > 5) {
      world.resetSecondSeriesIfStale(now);
      while (!world.isCaughtUp(Date.now())) {
        if (world.catchUpChunk(Date.now(), CHUNK_SECONDS) === 0) break;
      }
      const snapshot = world.series.get(activeTf).snapshot();
      post({ type: 'snapshot', tf: activeTf, snapshot, quote: world.quote }, snapshotTransferables(snapshot));
    }

    const q = world.revealTick(Date.now());
    if (q) {
      post({ type: 'tick', quote: q, live: liveCandleFor(activeTf), book: world.book(bookLevels) });
    }
    if (Date.now() - lastSave > SAVE_INTERVAL_MS) {
      void persist();
    }
  }, TICK_INTERVAL_MS);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  void (async () => {
    try {
      switch (msg.type) {
        case 'start':
          await start(msg.seedText);
          break;
        case 'subscribe': {
          activeTf = msg.tf;
          if (!world) break;
          const snapshot = world.series.get(activeTf).snapshot();
          post(
            { type: 'snapshot', tf: activeTf, snapshot, quote: world.quote },
            snapshotTransferables(snapshot),
          );
          break;
        }
        case 'setBookLevels':
          bookLevels = Math.max(4, Math.min(60, msg.levels));
          break;
        case 'flush':
          await persist();
          break;
        case 'reset':
          if (tickTimer !== null) clearInterval(tickTimer);
          tickTimer = null;
          world = null;
          await idbClearAll();
          await start();
          break;
      }
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
};

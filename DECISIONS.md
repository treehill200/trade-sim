# Decisions

A running log of the significant technical choices in this project, newest phase last.
Each line says what was decided and why, so the reasoning survives even when the code changes.

## Phase 1 — project setup, market engine, basic chart

### Stack and tooling
- **Vite + React + TypeScript (strict) + Zustand + Vitest** — as specified in the brief.
- **`strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`** — the code is full of
  typed-array indexing, and these flags catch the off-by-one mistakes that would otherwise show up
  as silent `NaN`s on the chart.
- **No charting library of any kind** — the chart is an original Canvas 2D engine written for this
  project, per the hard rule against TradingView code or assets.
- **Original branding ("Parcade") and lucide-react icons** — no third-party logos or icon assets.
- **Inter + JetBrains Mono from Google Fonts, with system fallbacks** — the app is fully usable if
  the fonts fail to load.

### Market engine
- **The simulation advances one second at a time, and every candle is built from that one stream.**
  Higher timeframes are aggregated from the same 1-second prints, so a 1m, a 1h and a 1D candle
  covering the same moment can never disagree. That is a structural guarantee, not a convention.
- **Each second is split into 4 sub-ticks.** They give the live candle something to move between
  whole seconds, and the second's OHLC is exactly those four prints.
- **`sfc32` (a fast sequential PRNG) rather than a counter-addressable hash.** The walk is inherently
  sequential — today's volatility depends on yesterday's — so addressable randomness bought nothing
  and cost about 4x the time. Reproducibility comes instead from always starting at genesis with the
  same seed, plus checkpoints that save the generator's state.
- **Normal draws use an Irwin-Hall approximation (four uniforms), not Box-Muller.** It avoids `log`
  and `cos` in a loop that runs tens of millions of times during backfill.
- **Price realism is layered, not a single random walk:** a slow Ornstein-Uhlenbeck log-volatility
  process (calm vs violent days), a fast GARCH(1,1) term (minute-scale clustering), regime switching
  between ranging and trending, intraday seasonality peaking at 13:00-16:00 UTC, Poisson liquidation
  cascades, and mean reversion toward a slowly drifting fair value so the price stays in a plausible
  band over months.
- **Cascades come in two shapes and give back a random fraction of the spike.** With a single shape
  every event looked like the same one-candle needle; mixing short flashes with multi-minute flushes,
  and varying how much of the move sticks, is what makes them read as market events.
- **Prices are integer cents throughout.** Tick size is $0.01, so OHLC values are exact integers and
  no float drift can creep into aggregation — and the trading engine in a later phase inherits that.
- **Volume and spread are derived from volatility**, so busy periods have fat volume bars and wider
  quotes, matching the brief.

### Storage and performance
- **The whole market runs in a Web Worker.** A first launch generates 30 days = 2.6 million simulated
  seconds; on the main thread that would freeze the page. It also means the live tick loop can never
  compete with rendering for frame time.
- **Candles live in columnar typed arrays (`Float64Array` / `Int32Array`), not arrays of objects.**
  The renderer walks tens of thousands of candles per frame; columnar storage keeps that
  allocation-free, and the arrays transfer to the main thread with zero copying.
- **Sub-minute timeframes are capped at 24 hours; 1m and above keep 30 days.** Keeping 30 days of
  1-second candles would cost hundreds of megabytes for data nobody looks at.
- **IndexedDB stores the candle series plus an engine checkpoint; localStorage stores UI settings.**
  Every storage call is wrapped so that private browsing or a full quota degrades to "no saved data"
  rather than a broken app.
- **Saved data carries an `ENGINE_VERSION`.** If the simulator changes in a way that would make old
  saved history disagree with freshly generated history, the old data is discarded and regenerated
  rather than stitched onto a walk that no longer matches it.
- **Returning after a gap replays only the missing seconds** from the checkpoint, so a reload costs
  about half a second instead of regenerating everything.

### Chart engine
- **Horizontal position is tracked in bar-index space, not time.** Panning then feels identical at
  every timeframe, and the chart can scroll past the newest candle into empty space.
- **The right-hand margin is measured in pixels, not bars.** The gap after the live candle stays
  visually constant while zooming; measuring it in bars made the live candle fly off-screen.
- **Zooming while pinned to the live edge changes only the bar width.** Anchoring on the cursor there
  would slide the newest candle away from the edge.
- **Below one candle per pixel, the visible range is reduced to one entry per pixel column once per
  frame**, and that reduction is shared by the auto-scale, the candles and the volume. At full
  zoom-out (about 30,000 candles on screen) this is what holds 60fps.
- **Dense volume is drawn as a single silhouette rather than thousands of thin rectangles.**
  Rasterising ~3,000 half-pixel rects cost 9ms a frame; per-candle colour is invisible at that
  density anyway.
- **`Intl.DateTimeFormat` instances are cached per time zone, and axis ticks are computed once a
  frame.** Constructing formatters per label was the single most expensive thing on the frame.
- **The OHLC legend is HTML over the canvas, not canvas text**, so the type stays crisp at any device
  pixel ratio and uses the app's font stack directly.
- **React never re-renders because a price moved.** Candle data is a mutable object the chart reads
  inside its own animation frame; components showing numbers subscribe to a throttled pulse instead.

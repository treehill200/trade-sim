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

## Phase 2 — chart types, visual polish and chart controls

### Structure
- **The renderer was split into four modules**: `geometry.ts` (visible range, the pixel-column
  reduction, auto-scaling), `plots.ts` (one function per chart type), `plotSeries.ts` (what a
  drawable series looks like), and `renderer.ts` (grid, axes, crosshair, volume, last price). Adding
  a chart type now means touching one file.
- **Every chart type flows through the same `PlotSeries` shape.** `CandleSeries` satisfies it
  directly; Heikin Ashi produces its own arrays of the same shape. Nothing downstream — auto-scale,
  pixel-column reduction, crosshair — needs to know which type is on screen.
- **Heikin Ashi is cached and extended incrementally.** Each candle depends on the one before it, so
  recomputing 43,000 of them every frame would be wasteful; the cache extends itself as candles
  arrive and always recomputes the newest one, which is still moving.
- **Hollow candles colour by the move since the previous close and hollow by close-vs-open.** That
  pairing carries two facts per candle instead of one, which is the point of the style.
- **Line and area charts auto-scale to closing prices only.** Scaling them to the high-low range
  would leave the line floating in the middle of empty space.

### Visual upgrades
- **The last price, and the newest candle's closing edge, are eased toward each new print.** Prints
  land four times a second and the chart draws sixty times a second, so without easing the live
  candle steps. The easing converges well inside one print, and the OHLC legend always shows the
  real values — the chart never displays a number it has not received.
- **A large jump snaps instead of easing.** A new timeframe or chart type is not the market moving,
  and sliding across the screen would look like a glitch.
- **The last-price line has a soft glow and a pulse dot on the newest candle.** Both are subtle on
  purpose; the first attempt read as a highlighted band across the chart.
- **The area chart and the dense volume silhouette are gradient-filled**, which reads better than a
  flat block at the bottom of the pane.
- **Rounded line joins are dropped once the line has more segments than the screen has pixels.**
  They cost rasterisation time for no visible difference.

### Controls
- **A small `chartController` handle**, rather than lifting the viewport into React state. The
  camera button and the date-range buttons need to drive the chart, but the viewport deliberately
  lives outside React so that panning never triggers a re-render.
- **The active date-range button clears the moment you zoom**, because the view no longer matches
  what the button claims.
- **Minimum bar spacing went to 0.015px** so "All" can actually fit a month of 1-minute candles;
  the pixel-column reduction means the cost is bounded by screen width, not candle count.
- **The volume histogram collapses to a silhouette below ~2.8px per bar** — the width at which
  every bar is one pixel anyway. Drawing them individually cost 9ms a frame for no visible gain.
- **The volume maximum is read from the pixel columns when they exist.** It is the same number, at a
  fraction of the work.

### Market tuning
- **Realised volatility is now around 80-100% annualised**, tuned down from ~120-145%. That is where
  a liquid crypto pair actually trades, and it keeps a month of history readable on one screen.
  A test pins it into a band so a future tuning mistake cannot quietly turn the market into a
  flatline or a rocket.
- **`ENGINE_VERSION` was bumped to 2**, so saved history generated by the old parameters is
  discarded and regenerated rather than being stitched onto a walk that no longer matches it.

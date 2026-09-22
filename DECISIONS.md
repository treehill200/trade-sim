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

## Phase 3 — indicators and multi-pane layout

### Structure
- **The viewport was split into a shared `TimeScale` and a per-pane `PriceScale`.** Every pane shares
  one horizontal scale — that is what makes the price chart and an RSI line up candle for candle —
  while each pane owns its vertical scale, because an RSI runs 0-100 and a price does not.
  `yOfPrice` returns absolute canvas coordinates, so a pane is just a `top` and a `height`.
- **Indicators are pure functions over the candle series**, writing into caller-supplied arrays with
  NaN through the warm-up region. That makes every one of them testable without a canvas.
- **Indicators are recomputed in full rather than updated incrementally.** The series only changes
  when a print arrives — a few times a second — not once per frame, and a full pass over 43,000
  candles is well under a millisecond. Streaming versions would need each indicator to save and
  restore its internal state to recompute the live candle: a lot of machinery, and a lot of places
  to get subtly wrong.
- **Results are cached against a fingerprint** of series identity, length, newest candle and
  parameters, so hovering the legend never triggers a recomputation.
- **Pane heights are relative weights, not fractions.** The price pane takes whatever the indicator
  panes leave, everything is normalised to fill the plot area exactly, and the price pane is never
  squeezed below 40% — stacking five indicators otherwise reduces the candles to a sliver.
- **Saved layouts are sanitised on load.** An indicator can be renamed, removed, or gain a new
  setting between releases; a half-built instance from an old layout would otherwise break the chart
  on startup.

### Correctness
- **`sma` and `rollingStdev` are NaN-aware.** Indicators chain — Stochastic smooths a series that
  already has a warm-up gap — and a running sum that swallows one NaN stays NaN forever. This was a
  real bug: Stochastic rendered as an empty pane until the windows were made to restart at a gap.
- **Wilder's smoothing (`rma`) is separate from `ema`.** RSI and ATR use k = 1/length, not
  2/(length+1); using a plain EMA gives numbers that disagree with every other platform.
- **Rolling max and min use a monotonic deque**, O(n) rather than O(n x length), which matters for a
  long Stochastic window over a 43,000-candle series.
- **MACD's signal EMA starts where the MACD line starts**, not at index 0, so the leading NaNs do not
  poison the whole series.
- **VWAP anchors to the UTC day** the candle opens in, and a test pins that it resets rather than
  dragging yesterday's average into today.

### Performance
Adding five indicators at full zoom-out took the frame from 17ms to 203ms. The fix came in stages,
each measured:
- **Nothing may build geometry per candle.** The histogram, the band fill and the volume silhouette
  each had a point or a rectangle per candle; at full zoom-out that is 43,000 of them. None of this
  showed up in a timer around the drawing code, because canvas work is deferred to paint — it only
  appeared as frames that took 200ms with 11ms of JavaScript in them.
- **`fillRect` in a loop beat every path-based approach.** For identical pixels, measured here: a
  `Path2D` of 3,000 rectangles cost 45ms, one closed polygon 16ms, a stroked polyline 13ms, and
  3,000 `fillRect` calls 3ms. Dense indicator lines are now filled columns drawn with `fillRect`.
- **Columns are reduced to CSS pixels, not device pixels.** At that density the line is a solid band
  either way, and it halves the work on a HiDPI screen.
- **One clip per pane, not one per series**, and reference lines and axis ticks computed once.

The result: five indicators across four panes render at 16.7ms (60fps) at normal zoom and 36ms with
the entire 30-day 1-minute history on screen — and that is with software rasterisation in a
container, which is the slow case.

## Phase 4 — drawing tools

### Anchoring
- **A drawing is a list of (time, price) points.** Nothing about it is stored in pixels, which is
  what makes a trend line sit across exactly the same candles when you switch from 5m to 1h, and
  what lets it be saved and restored without knowing anything about the viewport it was drawn in.
- **`DrawingMap` is the single place that converts between data and screen space.** Because the
  market is continuous, a timestamp maps to a bar index by plain arithmetic — including for times
  beyond the newest candle, which is what lets a ray extend into the empty space on the right.
- **Magnet mode snaps to the nearest of the candle's four prices**, and leaves the price untouched
  outside the series so you can still draw in that empty space.

### One geometry, two consumers
- **`resolveShape` turns a drawing into segments, areas, polygons and handles**, and both the
  renderer and the hit test work from it. Anything you can see is exactly what you can click, and
  the two can never drift apart as tools are added.
- **Handles win over the body in a hit test**, so grabbing an endpoint resizes instead of moving the
  whole shape — and a filled rectangle or channel can be grabbed from anywhere inside it.
- **The in-progress drawing renders through the same path as a committed one**, so the rubber band
  while you drag is literally the thing you are about to get.

### Interaction
- **The parallel channel is the only two-stage tool**: a drag fixes the base line, then the pointer
  sets how far the parallel sits from it and a click commits. Everything else completes in one
  gesture, and the position tools derive a sensible stop from the entry and target so a single drag
  produces a complete position.
- **The tool reverts to the cursor after each drawing**, which is the default everywhere and avoids
  a stray second shape from an accidental click.
- **A whole drag is one undo step.** `moveLive` mutates without touching history and `commit`
  records the pre-drag state once, so undo jumps back to before the drag rather than unwinding it
  one mouse-move at a time.
- **Undo history lives outside the store**, because it is neither persisted nor rendered — keeping
  it out means it cannot accidentally be serialised into a saved layout.
- **The text editor opens on pointer *up*, not pointer down.** This was a real bug: the browser's
  own handling of mousedown moves focus away from anything mounted during that event, which blurred
  the new input and discarded the label before it could be typed into. The input also ignores blur
  until it has genuinely been focused once.
- **An empty label is discarded**, so clicking with the text tool and changing your mind does not
  leave an invisible drawing behind.
- **Saved drawings are sanitised on load** for the same reason indicators are: a malformed one from
  an older version would otherwise throw while rendering and take the whole chart with it.

## Phase 5 — trading engine, order panel and account panel

### Money
- **Nothing is a float.** Dollars are integer cents, quantities are integer micro-units (a millionth
  of a DAVID). `dollarsToCents(0.1) + dollarsToCents(0.2)` is exactly 30, and a test says so.
- **`notional` splits the quantity into whole and fractional units before multiplying.** The obvious
  `price * qty / SCALE` reaches 4e15 for a thousand-DAVID position at $40,000 — uncomfortably close
  to the largest exact integer — so it is computed in two safe halves instead.
- **Rates are parts per million**, so a commission of 0.055% is the integer 550 and applying it is
  one multiply and one round.

### The engine is pure
- **Every operation takes an account and returns a new one.** Fills, commission, realised profit,
  margin and liquidation are therefore testable with no browser, no chart and no clock, and the UI
  cannot put the account into a state the engine did not sanction. 61 tests cover it.
- **A position stores its total cost, not an average price.** Reducing a position takes out exactly
  the proportional share of that cost, so partial closes cannot accumulate rounding error in the
  entry price — closing an awkward quantity in seven pieces at the entry price nets to exactly zero.
- **One `applyFill` handles all four cases** — opening, adding, reducing and reversing through flat —
  and unrealised profit is `notional(mark, qty) - cost`, which is correct for longs and shorts
  without a single branch on direction.

### Realism
- **Slippage grows with the square root-ish of size and linearly with volatility**, and always moves
  the price against the trader. A ten times larger order costs about four times the extra, which is
  how walking a real book behaves. Both slippage and the spread can be switched off.
- **Margin is measured against the mark price, not the entry**, so a position that moves in your
  favour ties up more margin — as it does on a real venue.
- **The liquidation price is solved analytically** from `equity = maintenance`, and a test checks
  that equity really does equal the maintenance requirement at the price the formula returns.
- **An order that reduces the position is never rejected for margin**, so a trader can always get
  out of trouble even when there is no free margin to get further into it.
- **Liquidation is checked off the market feed**, four times a second, not on render: equity has to
  be tested against prices as they arrive, not when the user next looks at the screen.

### State and UI
- **Account history is capped at 500 orders and executions.** Everything is written to localStorage,
  and the journal and statistics only ever need recent activity.
- **Saved accounts are sanitised on load**, filling in any setting that did not exist when they were
  written — an undefined leverage would otherwise quietly break the margin maths.
- **The starting balance can only be changed on an untouched account**, because changing it
  mid-session would make the realised-profit figures meaningless.
- **Notices are a small store with a render-time timer**, so a liquidation can be reported from
  outside React and still appear as a toast.

## Phase 6 — resting orders, brackets and on-chart order management

### Order semantics
- **A resting limit fills at its own price.** It was already in the book when the market reached it,
  so a gap straight through does not improve the fill — and never worsens it. This was wrong on the
  first attempt ("limit or better"), which handed the trader a better price than they had asked for
  whenever the market gapped past a resting order; the tests caught it.
- **A limit placed through the spread is an aggressive order.** It takes liquidity immediately at
  the market price, capped at its own limit, and pays the taker fee — which is what a real venue
  does with a marketable limit.
- **Stops trigger on the last price and then fill at market**, so they take slippage exactly as a
  manual market order would. A stop-limit's trigger latches: once hit, it stays a resting limit even
  if the price comes back.
- **Fills are matched against the range the price covered since the previous tick**, not against the
  tick itself, so an order is filled when the market traded through it even though no tick landed on
  its exact price.
- **Limits pay the maker fee, stops the taker fee**, because one was the resting side of the trade
  and the other was not.

### Brackets
- **OCO is one shared group id.** A take-profit and its stop-loss carry the same group; whichever
  fills first cancels the other. That is the entire mechanism.
- **Exits are reduce-only** and are clamped to the position's current size, so a bracket placed on a
  larger position cannot flip it after the position has been partly closed.
- **A single violent move that crosses both exits fills exactly one of them.** Orders are processed
  in sequence and each fill re-checks the ones after it.
- **Brackets ride along on the entry order** and are turned into real orders the moment it fills, so
  a limit entry with exits attaches them when it triggers rather than immediately.
- **Flattening the position by any route cancels every reduce-only order**, so closing by hand never
  leaves an orphaned stop behind.

### On-chart management
- **The lines are computed from the account, not stored.** The chart therefore cannot show an order
  or a position that does not exist, and there is no state to keep in sync.
- **Lines are drawn on the canvas; their buttons are HTML.** The line has to pan and zoom with the
  chart, but a cancel button should be a real button with a real hit area — so the canvas draws the
  line, the label and the axis tag, and an overlay positions the controls by reading the chart's
  mapping through a plain holder rather than React state. The render loop stays free of React.
- **Only working orders are draggable.** A position's entry and its liquidation price are
  consequences of the position, not values a user can set.
- **Execution markers point away from the candle** — buys below, sells above — so a marker never
  hides the price action it refers to, and a liquidation gets a ring so it reads differently from a
  manual fill.
- **The DOM places a limit on click and a stop on shift-click.** A limit at a level is what resting
  there means; a stop is the breakout order, so it takes the modifier.

## Phase 7 — journal, statistics, alerts, accounts and polish

### The trade journal
- **A "trip" is derived from the execution log, never stored.** The journal walks the fills in order
  and closes a trip whenever the net position returns to flat, so the round-trip table is always
  consistent with the fills that produced it — there is no second record to keep in sync.
- **A reversal closes one trip and opens the next in the same fill.** The order that flips a long
  into a short is the exit of the long and the entry of the short; the new trip gets the id
  `${executionId}-r` so it is still stable across reloads.
- **A trip's entry and exit prices are size-weighted averages**, because a position built or closed
  in pieces has no single price.
- **Fees are attributed to the trip that paid them**, so the net figure in the journal is what
  actually hit the balance rather than a gross number with a footnote.
- **Notes are keyed by trip id, on the account.** Each note belongs to a specific round trip, and
  because trip ids are derived deterministically from the fills, a note stays attached to its trade
  after a reload.

### Statistics
- **Every statistic is computed from the trips on the fly**, not accumulated as trades happen. It is
  cheap (a few hundred trips at most), and it means resetting or switching an account cannot leave a
  stale counter behind.
- **Win rate counts trips, not fills**, which is what a trader means by it.
- **Profit factor with no losses is ∞ rather than a divide-by-zero**, shown as "∞" instead of a
  number that would look like a bug.
- **Max drawdown is measured on the closed-trade equity curve**, so it is the drawdown of the
  realised record and does not swing around with an open position's mark.

### The equity curve
- **Its own small canvas rather than a pane on the main chart.** Its x axis is trade number, not
  time, so it does not belong on a price chart at all.
- **It is filled down to the starting balance**, so the shaded area reads as profit or loss at a
  glance, and it is coloured by the final result rather than segment by segment.
- **A ResizeObserver redraws it** because the account panel is resizable, so measuring once at mount
  would leave a stretched canvas.

### Price alerts
- **An alert is checked against the range the price covered since the previous tick**, exactly as
  orders are, so a fast move cannot slip between two samples and leave the alert armed.
- **Alerts are one-shot and stay in the list, disarmed.** A repeating alert would spam the moment
  the price sits on the level; keeping the fired alert visible with a re-arm button is more useful
  than deleting it.
- **The direction is inferred from where you put it** — above the market means "on the way up" —
  because that is what dropping a line at a price means, and it removes a choice nobody wants to
  make.
- **Alert lines live on the chart and can be dragged**, using the same order-line machinery, so
  moving an alert works the way moving an order does.
- **Sounds are synthesised with the Web Audio API, not shipped as files.** One beep is not worth a
  request, and audio is blocked until the user has interacted with the page — so every call is
  wrapped and a failure is simply silence.
- **The alert chime and the fill tone are deliberately different** (two rising notes versus one
  short note, rising for a buy and falling for a sell) so they are never confused when both happen
  at once.
- **Spoken fills go through `speechSynthesis` and cancel whatever was being said.** In a fast market
  the current fill matters and a backlog of announcements does not.

### Multiple accounts
- **The store holds an array of accounts and an active id**, and every action operates on the active
  one. Nothing else in the app had to learn that accounts are plural.
- **A new account inherits the current account's settings**, because the usual reason to make one is
  to try the same setup again.
- **Deleting an account needs a second click**, and the last account cannot be deleted, so there is
  always somewhere for a fill to go.
- **The account popover is positioned in viewport coordinates.** The summary strip scrolls
  horizontally and sits at the bottom of the window, so a popover in normal flow would be clipped by
  the strip and would open off the bottom of the screen.

### Polish
- **The shortcut list is one dialog, opened by `?`**, and it is the only place shortcuts are
  documented in the app, so there is nowhere for a second list to fall out of date.
- **`?` is ignored while a text field has focus**, so typing a question mark in a note or a label
  does not open a dialog.
- **The bell carries a count of armed alerts**, which is the only piece of trading state that is
  otherwise invisible once its dialog is closed.

## Final pass — recovery and browser compatibility

### Recovering from a broken state
- **A React error boundary wraps the whole app.** Without one, a single bad render leaves a blank
  white page: no explanation, and nothing for a non-technical user to do.
- **The two things offered are a reload and a clean slate**, because a component that crashes once
  has almost always been handed state it cannot read, and those are the only two recoveries a user
  can actually perform themselves. The same pair is offered when the market worker fails to start,
  which was previously a dead end.
- **"Start over" clears by prefix, not by a list of keys**, so a store added later cannot be left
  behind — and it collects the keys before removing any of them, because removing while iterating by
  index skips every other one. There is a test for exactly that.
- **The reload happens even if clearing failed.** A reload alone fixes a transient failure, and
  there is nothing better to offer if it does not.

### Safari
- **`color-mix` is gone from the depth ladder's bars**, replaced by a solid colour at low opacity.
  The bar is what the ladder is for, so it must not depend on a newer CSS function; the remaining
  uses of `color-mix` are decorative tints that degrade to nothing in particular.
- **The loading overlay has an opaque fallback before its translucent one.** A loading screen you
  can see through to a half-drawn chart is worse than a solid one.
- **`-webkit-` prefixes for `backdrop-filter` and `user-select`**, which Safari only dropped in
  versions 18 and 16.4 respectively.
- **The production worker is a classic worker, not a module one.** Vite bundles it that way, which
  widens support at no cost to the source, where it stays an ES module.

## Order affordability

- **The panel asks the engine whether an order would be accepted; it does not work it out itself.**
  It used to compare margin against available funds on its own, which ignored the commission — so at
  high leverage the panel would show "required margin 95,000, available 100,000", enable the submit
  button, and then reject the order. From the user's side that is indistinguishable from a broken
  app. `previewOrder` is now the single answer both the panel and the submit path use, and a test
  sweeps sizes across the boundary asserting the two never disagree.
- **The commission is shown before you commit**, labelled "Commission on fill" for a resting order,
  because it is charged when the order fills rather than when it is placed.
- **The "%" control divides up the largest order that would actually be accepted**, found by
  bisecting on the engine's own preview rather than by algebra. The cost of an order is not
  proportional to its size — slippage grows with it, the spread is paid across all of it, and an
  existing position may be reduced rather than grown — so a formula would be an approximation that
  drifts the moment any rule changes. 100% now fills and leaves available margin at zero.
- **A rejection says how much short it is**, not merely that something is wrong, and the panel says
  so before the order is sent rather than after.
- **Running out of room says so.** A percentage of nothing is nothing, which would otherwise leave
  the submit button dead with no explanation.

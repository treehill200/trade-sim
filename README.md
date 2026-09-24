# David Coin Day Trading Simulator

A day-trading simulator for one fictional crypto market — **David Coin (DAVID/USD)** — built as a
single-page web app with an interface modelled on a professional charting terminal.

Everything is simulated: the prices, the order book, the fills and the account. There is no real
market data, no real money, and no server. It all runs in your browser.

## Running it

You need [Node.js](https://nodejs.org) 18 or newer. Then, in this folder:

```bash
npm install
npm run dev
```

Open the address it prints (usually <http://localhost:5173>) in Chrome or Safari.

**The first launch takes a few seconds.** It is generating 30 days of David Coin price history — you
will see a progress bar while it works. After that, the history is saved in your browser, so every
later visit opens almost instantly.

### Other commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app for local use |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Re-run tests as you edit |
| `npm run build` | Produce an optimised build in `dist/` |
| `npm run typecheck` | Check types without building |

## The chart

- **Watch the market move.** One 1-minute candle takes one real minute, and the price updates four
  times a second, so the newest candle is always alive.
- **Switch timeframes** — 1s through 1D, from the buttons in the top bar or the dropdown next to
  them.
- **Switch chart types** — candles, hollow candles, OHLC bars, Heikin Ashi, line and area, from the
  chart-type menu in the middle of the top bar.
- **Pan** by dragging the chart, **zoom** with the scroll wheel or a trackpad pinch.
- **Rescale the price axis** by dragging it up or down; **double-click it** to go back to
  auto-scaling. Double-click the chart itself to reset the whole view.
- **Follow the crosshair** — the OHLC readout in the top-left corner follows whichever candle you
  are pointing at.
- **Jump back to the present** with the round button that appears once you scroll into history.
- **Toggle volume, auto-scale, log scale, the light theme and fullscreen** from the top-right icons.
- **Fit a span of history** with the 1D / 5D / 1M / All buttons in the bottom-left corner.
- **Change the cursor** between cross, dot and arrow, from the menu next to the chart-type menu.
- **Add indicators** from the "Indicators" button in the top bar: moving averages, VWAP and
  Bollinger Bands draw over the candles; volume, RSI, MACD, ATR and Stochastic get their own pane.
  A green "Added" marks the ones on your chart — click one of those again to take it off.
- **Tune or remove any indicator** from its legend line on the chart — the eye hides it, the gear
  opens its settings (lengths, colours, line widths) and the X removes it.
- **Resize a pane** by dragging the gap between it and its neighbour.
- **Draw on the chart** from the toolbar down the left edge: trend lines, rays, horizontal and
  vertical lines, parallel channels, rectangles, Fibonacci retracements, long and short position
  tools, price and date range measures, text labels, arrows and a freehand brush.
- **Edit a drawing** by clicking it: drag it to move, drag a handle to reshape, right-click for
  colour, width, dash, clone, lock and delete, and press Delete to remove it.
- **Save a PNG of the chart** with the camera button.
- **Change your time zone** from the dropdown in the bottom-right corner.
- **See every shortcut** by pressing `?`, or with the keyboard button in the top-right corner.

## Trading

The panel on the right places orders; the panel along the bottom tracks the account.

- **Buy or sell at market** — pick a side, type a size in DAVID, in USD, or as a percentage of what
  your leverage lets you put to work, and submit. The summary shows the trade value, the margin it
  needs, the commission it will pay and what you have available before you commit. At 100% the size
  is the biggest order the account can actually take, commission and spread included.
- **Limit, stop and stop-limit orders** rest until the market reaches them. A limit gets its own
  price; a stop triggers on the last price and then fills at market, slippage and all.
- **Take-profit and stop-loss brackets**, set by price, ticks, percentage or dollar amount. They are
  linked: whichever fills first cancels the other, and closing the position by any route cancels
  both.
- **Manage orders on the chart.** Working orders appear as labelled lines with an X to cancel. Each
  line carries its label in the middle of the chart with a grip mark on it — drag that to move the
  order, which is the easiest way to set a take-profit or stop-loss by eye. The position line shows its size and live P&L with buttons
  to add brackets, reverse or close. Arrows mark every candle where a fill happened.
- **Trade from the DOM.** Click a level in the depth ladder for a limit order there, or hold shift
  for a stop.
- **One net position per account.** Buying while short reduces the short, and a big enough order
  reverses straight through flat. The Positions row has Reverse and Close buttons.
- **Leverage from 1x to 125x**, custom starting balance, maker and taker commissions, maintenance
  margin, and switches for slippage and the bid/ask spread — all in the gear icon on the order
  panel.
- **Liquidation is real.** The position's liquidation price is shown on the Positions row, and if
  equity falls below the maintenance requirement the position is closed automatically with a notice
  telling you what happened.
- **The bottom panel** shows balance, equity, realised and unrealised P&L, available funds, orders
  margin, margin buffer and fees paid, with tabs for Positions, Working Orders, Order History, the
  Trade Journal and Stats. Drag its top edge to resize it, or collapse it with the chevron.

Everything is simulated and nothing leaves your browser. There is no real money involved at any
point.

## The trade journal and your stats

Open the **Trade Journal** tab in the bottom panel. Every completed round trip — from the moment you
opened a position to the moment it went flat again — gets a row with when it started, the side, the
size, the average entry and exit prices, gross P&L, fees, net P&L and how long you held it. Click
the note column to write down why you took the trade; the note is saved with it.

The **Stats** tab turns those trips into the numbers worth watching: trades taken, win rate, wins
and losses, average and largest win and loss, profit factor, expectancy, max drawdown, best and
worst streaks, total fees and the net result. Beside them is your **equity curve**, drawn trade by
trade against your starting balance — above the dashed line is profit, below it is loss.

A trip is worked out from your fills, so the journal and the stats can never disagree with your
order history. Reversing straight from long to short closes one trade and opens the next, exactly as
you would count it yourself.

## Price alerts

Click the **bell** in the top-right corner. Type a price and press "Add alert" — an alert above the
current price fires on the way up, and one below it fires on the way down. The bell shows how many
alerts are armed.

Faster still: hover the chart where you want it and press `Alt`+`A`. The alert appears as a dashed
orange line with a tag on the price axis, and you can **drag the line** to move it.

When the price reaches it you get a notice in the corner, a chime, and the alert stays in the list
marked as fired — with a button to arm it again. Alerts are checked against everything the price did
between updates, so a violent move cannot slip past one.

### Sound

In the same dialog:

- **Chime when an alert fires** — a two-note chime.
- **Tone when an order fills** — one short note, rising for a buy and falling for a sell.
- **Say "order filled" out loud** — your browser reads out every fill, including take-profits, stop
  losses and liquidations. Off by default.

Each has a Test button next to it. Browsers stay silent until you have clicked something on the page,
so if you hear nothing at first, click anywhere and try again.

## Multiple accounts

Click the account name at the right-hand end of the bottom panel's summary row — it says "Main" to
begin with — to open the account list. Every account shows its live equity. From there you can
**switch** between them, **rename** one with the pencil, **delete** one with the bin (twice, and
never the last one), or start a **New account** that inherits your current settings.

Each account keeps its own balance, position, orders, order history, journal, notes and settings, so
you can run a careful account and a reckless one side by side against the same market.

## Every shortcut

Press `?` at any time for the full list. In short:

| Shortcut | Does |
| --- | --- |
| Drag / wheel / pinch | Pan and zoom |
| Drag either axis | Stretch that scale |
| Double-click | Reset the view |
| `Esc` | Cancel the drawing in progress, or drop back to the cursor |
| `Delete` | Remove the selected drawing |
| `Alt`+`H` | Horizontal line at the crosshair |
| `Alt`+`A` | Price alert at the crosshair |
| `Cmd`/`Ctrl`+`Z` | Undo |
| `Cmd`/`Ctrl`+`Shift`+`Z` | Redo |
| Click a DOM level | Limit order there |
| Shift-click a DOM level | Stop order there |
| `?` | This list |

## Drawing tools

The left-hand toolbar groups the tools the way a charting terminal does — click a group to use its
current tool, or click again to pick a different one from the flyout. Underneath are magnet mode
(snap new points to the nearest open, high, low or close), lock all, hide all, undo, redo and
remove all.

Drawings are anchored to a time and a price, so they stay exactly where you put them across any
amount of panning, zooming and timeframe switching — and they come back after a reload.

## Indicators

Nine to choose from, searchable from the "Indicators" button:

| On the price chart | In their own pane |
| --- | --- |
| Moving Average (Simple) | Volume |
| Moving Average (Exponential) | Relative Strength Index |
| VWAP (session, anchored to each UTC day) | MACD |
| Bollinger Bands | Average True Range |
| | Stochastic |

Every one of them updates live on each price tick, follows the crosshair, and is saved with your
layout — including its settings, colours and the height of its pane.

## How the market works

The price is not a coin flip repeated forever. Underneath there is a model with calm and violent
stretches, trending and ranging phases, a busier session around 13:00–16:00 UTC, occasional
liquidation cascades that spike and partly retrace, volume that rises with activity, and a bid/ask
spread that widens when things get volatile.

It is also **deterministic**. The entire history comes from one seed, which means:

- Reloading the page shows you the same history you saw before, not a new random one.
- Closing the tab and coming back later fills in the prices that "happened" while you were away.
- Every timeframe agrees with every other one, because they are all built from the same one-second
  stream of prices.

## Project layout

```
src/
  engine/      the market simulator, candle storage and timeframe aggregation
  workers/     the Web Worker the market runs in, and its message protocol
  chart/       the canvas charting engine: scales, panes, renderer, chart types
  indicators/  indicator maths, the catalogue, and the result cache
  drawings/    drawing model, coordinate mapping, geometry and rendering
  trading/     exact money arithmetic, the order engine and account metrics
  state/       Zustand UI store and the main-thread client for the market worker
  storage/     IndexedDB and localStorage helpers
  ui/          React components for the toolbars, legends, panels and dialogs
tests/         Vitest suites for the market, chart maths, indicators, drawings, trading,
               orders, the journal and alerts
```

## What is saved

Nothing needs saving by hand. The moment you change something it is written to your browser:

- **In IndexedDB:** the David Coin price history and the simulator's own state, so the market picks
  up exactly where it left off.
- **In localStorage:** your timeframe, chart type, theme, time zone, axis settings, indicators and
  their pane heights, every drawing, your accounts with their balances, positions, orders, history
  and journal notes, your alerts, and the sound switches.

Close the tab for an hour and come back: the chart fills in the candles that "happened" while you
were away, and everything else is where you left it.

## Starting over

If you ever want a brand new David Coin history, clear the site's data in your browser
(DevTools → Application → Storage → Clear site data) and reload. The app will backfill a fresh
30 days.

## If something goes wrong

If the app ever hits a problem it cannot recover from, it says so on a plain card with two buttons
rather than going blank:

- **Reload the page**, which fixes almost everything.
- **Clear saved data and start over**, which throws away the saved market, your accounts, drawings
  and settings, and starts a brand new market from scratch. Use it only if reloading does not help.

The same two buttons appear if the market itself fails to start.

## Notes

- No TradingView code, libraries, icons, names or assets are used anywhere. The charting engine is
  original, and the icons come from [lucide](https://lucide.dev).
- Nothing leaves your browser. There is no backend and no network call beyond loading the page and
  its fonts.

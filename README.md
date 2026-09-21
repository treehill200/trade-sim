# David Coin Day Trading Simulator

A day-trading simulator for one fictional crypto market — **David Coin (DAVID/USD)** — built as a
single-page web app with an interface modelled on a professional charting terminal.

Everything is simulated: the prices, the order book, the fills and the account. There is no real
market data, no real money, and no server. It all runs in your browser.

> **Build status:** Phases 1-2 of 7 are complete — the market engine and the chart. The trading
> side (orders, positions, PnL) arrives in later phases. See `DECISIONS.md` for the running log of
> technical choices.

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

## What you can do right now

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
- **Save a PNG of the chart** with the camera button.
- **Change your time zone** from the dropdown in the bottom-right corner.

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
  engine/     the market simulator, candle storage and timeframe aggregation
  workers/    the Web Worker the market runs in, and its message protocol
  chart/      the canvas charting engine: viewport, renderer, formatting, theme
  state/      Zustand UI store and the main-thread client for the market worker
  storage/    IndexedDB and localStorage helpers
  ui/         React components for the toolbar, legend and status bars
tests/        Vitest suites for the engine, aggregation and chart maths
```

## Starting over

If you ever want a brand new David Coin history, clear the site's data in your browser
(DevTools → Application → Storage → Clear site data) and reload. The app will backfill a fresh
30 days.

## Notes

- No TradingView code, libraries, icons, names or assets are used anywhere. The charting engine is
  original, and the icons come from [lucide](https://lucide.dev).
- Nothing leaves your browser. There is no backend and no network call beyond loading the page and
  its fonts.

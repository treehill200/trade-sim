import { Rng } from './rng';
import type { MarketConfig } from './config';

/**
 * Deterministic market simulator for DAVID/USD.
 *
 * The walk advances one simulated second at a time. Each second is split into
 * `subTicksPerSecond` price updates so the live candle moves smoothly, and the
 * second's OHLC is built from exactly those updates — so a 1s candle, a 1m
 * candle and a 1D candle all describe the same underlying prints.
 *
 * Price behaviour is deliberately not a plain random walk. Layered on top of
 * the base diffusion are:
 *   - a slow log-volatility process (Ornstein-Uhlenbeck) for calm vs violent days
 *   - a fast GARCH(1,1) term for minute-scale volatility clustering
 *   - regime switching between ranging and trending markets
 *   - intraday volatility seasonality peaking around 13:00-16:00 UTC
 *   - Poisson liquidation cascades that spike and partially retrace (wicks)
 *   - mean reversion toward a slowly drifting fair value, so price stays sane
 */

export interface SimState {
  /** Seconds elapsed since genesis; the next second to be produced. */
  second: number;
  /** Natural log of the last price (in dollars). */
  logPrice: number;
  /** Log of the slow-moving fair value the price reverts toward. */
  logAnchor: number;
  /** Slow OU log-volatility factor. */
  slowVol: number;
  /** Fast GARCH conditional variance of the standardised shock (mean 1). */
  garch: number;
  /** Last standardised shock, fed back into the GARCH recursion. */
  lastShock: number;
  /** 0 = ranging, 1 = trending up, 2 = trending down. */
  regime: number;
  /** Seconds left in the current regime. */
  regimeLeft: number;
  /** Per-second log drift contributed by the current regime. */
  regimeDrift: number;
  /** Volatility multiplier contributed by the current regime. */
  regimeVol: number;
  /** Seconds left in an active liquidation cascade. */
  cascadeLeft: number;
  /** Total length of the active cascade, used to shape spike vs retrace. */
  cascadeLen: number;
  /** +1 or -1: direction of the active cascade. */
  cascadeDir: number;
  /** Strength multiplier of the active cascade. */
  cascadeMag: number;
  /** Fraction of the cascade's spike that gets given back afterwards. */
  cascadeRetrace: number;
  /** PRNG words, so a checkpoint resumes the identical sequence. */
  rng: [number, number, number, number];
}

/** One fully-formed second of market activity. */
export interface SecondResult {
  /** Candle start, ms since epoch. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Price in cents after each sub-tick, length = subTicksPerSecond. */
  subPrices: Int32Array;
  /** Volume traded in each sub-tick. */
  subVolumes: Float64Array;
  /** Half-spread in cents at the end of the second. */
  halfSpreadCents: number;
  /** Instantaneous volatility, normalised so 1 = typical. */
  volFactor: number;
}

// --- Tuned constants -------------------------------------------------------

/** Per-second log-return standard deviation at "typical" volatility. */
const BASE_SIGMA = 1.15e-4; // ~= 65% annualised

/** Slow OU volatility: mean-reversion rate and shock size per second. */
const SLOW_VOL_KAPPA = 1 / (6 * 3600); // half-life ~4.2 hours
const SLOW_VOL_ETA = Math.sqrt(2 * SLOW_VOL_KAPPA * 0.45 * 0.45);

/** Fast GARCH(1,1) on standardised shocks; omega keeps the mean at 1. */
const GARCH_ALPHA = 0.055;
const GARCH_BETA = 0.935;
const GARCH_OMEGA = 1 - GARCH_ALPHA - GARCH_BETA;

/** Fair value drifts slowly and price is pulled toward it. */
const ANCHOR_ALPHA = 1 / (2 * 86400); // EMA half-life ~1.4 days
const MR_KAPPA_RANGE = 1 / (4 * 3600);
const MR_KAPPA_TREND = 1 / (36 * 3600);

/** Liquidation cascades: expected frequency and shape. */
const CASCADE_PROB_PER_SECOND = 1 / (4 * 3600); // ~6 per day
/** Share of a cascade spent spiking before the retrace begins. */
const CASCADE_SPIKE_FRACTION = 0.4;
const CASCADE_DOWN_BIAS = 0.56; // cascades are more often downward

/** Volume model. */
const BASE_VOLUME_PER_SECOND = 2.6; // DAVID units

/** Quoted spread as a fraction of price at typical volatility. */
const BASE_REL_SPREAD = 0.00006;

// --- Intraday volatility seasonality --------------------------------------

/**
 * Volatility multiplier by UTC hour, sampled hourly and interpolated.
 * Quiet through the Asian late session, building into the European open and
 * peaking across the 13:00-16:00 UTC US overlap.
 */
const HOURLY_VOL: readonly number[] = [
  0.88, 0.82, 0.78, 0.74, 0.72, 0.75, // 00-05
  0.82, 0.92, 1.02, 1.08, 1.06, 1.02, // 06-11
  1.08, 1.28, 1.42, 1.38, 1.24, 1.12, // 12-17
  1.04, 0.98, 0.96, 0.98, 1.00, 0.94, // 18-23
];

/** Smoothly interpolated seasonality factor for a given timestamp. */
export function seasonalVol(ms: number): number {
  const dayMs = ((ms % 86_400_000) + 86_400_000) % 86_400_000;
  const pos = (dayMs / 3_600_000) % 24;
  const i = Math.floor(pos);
  const frac = pos - i;
  const a = HOURLY_VOL[i % 24] as number;
  const b = HOURLY_VOL[(i + 1) % 24] as number;
  // Cosine interpolation keeps the curve smooth across hour boundaries.
  const t = 0.5 - 0.5 * Math.cos(Math.PI * frac);
  return a + (b - a) * t;
}

export class MarketSimulator {
  readonly config: MarketConfig;
  private readonly rng: Rng;
  private state: SimState;
  private readonly subTicks: number;
  private readonly subPrices: Int32Array;
  private readonly subVolumes: Float64Array;

  constructor(config: MarketConfig, restore?: SimState) {
    this.config = config;
    this.subTicks = config.subTicksPerSecond;
    this.subPrices = new Int32Array(this.subTicks);
    this.subVolumes = new Float64Array(this.subTicks);
    this.rng = new Rng(config.seed);

    if (restore) {
      this.state = { ...restore, rng: [...restore.rng] as [number, number, number, number] };
      this.rng.restore(this.state.rng);
    } else {
      const logP = Math.log(config.startPriceCents / 100);
      this.state = {
        second: 0,
        logPrice: logP,
        logAnchor: logP,
        slowVol: 0,
        garch: 1,
        lastShock: 0,
        regime: 0,
        regimeLeft: 0,
        regimeDrift: 0,
        regimeVol: 1,
        cascadeLeft: 0,
        cascadeLen: 0,
        cascadeDir: 0,
        cascadeMag: 0,
        cascadeRetrace: 0,
        rng: this.rng.save(),
      };
    }
  }

  /** Current second index (the next second that `stepSecond` will produce). */
  get second(): number {
    return this.state.second;
  }

  /** Wall-clock timestamp of the next second to be produced. */
  get nextTime(): number {
    return this.config.genesisMs + this.state.second * 1000;
  }

  get priceCents(): number {
    return Math.round(Math.exp(this.state.logPrice) * 100);
  }

  /** A deep copy of the simulator state, safe to persist as a checkpoint. */
  checkpoint(): SimState {
    return { ...this.state, rng: this.rng.save() };
  }

  private rollRegime(): void {
    const s = this.state;
    const r = this.rng.next();
    if (r < 0.46) {
      s.regime = 0; // ranging
      s.regimeDrift = 0;
      s.regimeVol = this.rng.range(0.7, 0.95);
    } else {
      const up = this.rng.next() < 0.5;
      s.regime = up ? 1 : 2;
      // A trend that moves 1%-5% over its lifetime.
      const strength = this.rng.range(1.0e-6, 4.4e-6);
      s.regimeDrift = up ? strength : -strength;
      s.regimeVol = up ? this.rng.range(0.92, 1.15) : this.rng.range(1.0, 1.35);
    }
    // Exponential-ish duration, 12 minutes to ~5 hours, mean around 90 min.
    const u = Math.max(this.rng.next(), 1e-6);
    s.regimeLeft = Math.round(Math.min(5 * 3600, 720 - Math.log(u) * 4200));
  }

  /**
   * Occasionally kick off a liquidation-style move.
   *
   * Two shapes: a short flash spike that shows up as a single long wick, and a
   * slower cascade that plays out over several minutes. Without the slower
   * kind every event looked like a one-candle data glitch rather than a real
   * market flush.
   */
  private maybeStartCascade(): void {
    const s = this.state;
    if (s.cascadeLeft > 0) return;
    if (this.rng.next() >= CASCADE_PROB_PER_SECOND) return;
    const flash = this.rng.next() < 0.3;
    if (flash) {
      s.cascadeLen = this.rng.int(8, 45);
      s.cascadeMag = this.rng.range(2.5, 8);
    } else {
      s.cascadeLen = this.rng.int(70, 420);
      s.cascadeMag = this.rng.range(1.1, 3.6);
    }
    s.cascadeLeft = s.cascadeLen;
    s.cascadeDir = this.rng.next() < CASCADE_DOWN_BIAS ? -1 : 1;
    // Some flushes hand the whole move back as a wick; others leave most of it
    // on the chart as a genuine break. Mixing the two is what stops every
    // event from looking like the same needle.
    s.cascadeRetrace = this.rng.range(0.25, 1.0);
  }

  /**
   * Advance the simulation by one second and return that second's candle.
   *
   * The returned object is reused between calls for the sub-tick arrays, so
   * copy anything you need to keep.
   */
  stepSecond(out: SecondResult): SecondResult {
    const s = this.state;
    const time = this.config.genesisMs + s.second * 1000;

    if (s.regimeLeft <= 0) this.rollRegime();
    s.regimeLeft -= 1;
    this.maybeStartCascade();

    // --- volatility for this second -------------------------------------
    s.slowVol += -SLOW_VOL_KAPPA * s.slowVol + SLOW_VOL_ETA * this.rng.normal();
    // Clamp keeps the exponential from producing absurd excursions.
    if (s.slowVol > 1.6) s.slowVol = 1.6;
    else if (s.slowVol < -1.2) s.slowVol = -1.2;

    s.garch = GARCH_OMEGA + GARCH_ALPHA * s.lastShock * s.lastShock + GARCH_BETA * s.garch;
    if (s.garch > 25) s.garch = 25;

    const season = seasonalVol(time);
    let volFactor = Math.exp(s.slowVol) * Math.sqrt(s.garch) * season * s.regimeVol;

    // --- drift for this second -------------------------------------------
    const mrKappa = s.regime === 0 ? MR_KAPPA_RANGE : MR_KAPPA_TREND;
    let drift = s.regimeDrift + mrKappa * (s.logAnchor - s.logPrice);

    let cascadeBoost = 0;
    if (s.cascadeLeft > 0) {
      const elapsed = s.cascadeLen - s.cascadeLeft;
      const spikePhase = elapsed < s.cascadeLen * CASCADE_SPIKE_FRACTION;
      // Spike hard in one direction, then give back `cascadeRetrace` of it.
      // The retrace runs over a longer stretch, so its per-second drift is
      // scaled down to remove exactly that fraction of the spike.
      const shape = spikePhase
        ? 1
        : (-s.cascadeRetrace * CASCADE_SPIKE_FRACTION) / (1 - CASCADE_SPIKE_FRACTION);
      drift += s.cascadeDir * shape * s.cascadeMag * BASE_SIGMA * 2.2;
      volFactor *= 1 + s.cascadeMag * 0.55;
      cascadeBoost = s.cascadeMag;
      s.cascadeLeft -= 1;
    }

    const sigma = BASE_SIGMA * volFactor;

    // --- walk the sub-ticks ----------------------------------------------
    const n = this.subTicks;
    const subSigma = sigma / Math.sqrt(n);
    const subDrift = drift / n;
    const openCents = Math.round(Math.exp(s.logPrice) * 100);
    let high = openCents;
    let low = openCents;
    let shockSum = 0;
    let totalVolume = 0;

    const seasonVolume = 0.55 + 0.45 * season;
    for (let i = 0; i < n; i++) {
      const z = this.rng.normal();
      shockSum += z;
      s.logPrice += subDrift + subSigma * z;
      const c = Math.max(1, Math.round(Math.exp(s.logPrice) * 100));
      this.subPrices[i] = c;
      if (c > high) high = c;
      if (c < low) low = c;
      // Volume rises with the size of the move and with the session profile.
      const intensity = 0.35 + 0.9 * Math.abs(z) + 0.5 * volFactor + 0.4 * cascadeBoost;
      const noise = 0.5 + this.rng.next() * 1.3;
      const v = (BASE_VOLUME_PER_SECOND / n) * intensity * noise * seasonVolume;
      this.subVolumes[i] = v;
      totalVolume += v;
    }

    const closeCents = this.subPrices[n - 1] as number;
    s.lastShock = shockSum / Math.sqrt(n);
    s.logAnchor += ANCHOR_ALPHA * (s.logPrice - s.logAnchor);
    s.second += 1;

    out.time = time;
    out.open = openCents;
    out.high = high;
    out.low = low;
    out.close = closeCents;
    out.volume = totalVolume;
    out.subPrices = this.subPrices;
    out.subVolumes = this.subVolumes;
    out.halfSpreadCents = halfSpreadCents(closeCents, volFactor);
    out.volFactor = volFactor;
    return out;
  }
}

/** Half the quoted spread, in cents, for a price at a given volatility. */
export function halfSpreadCents(priceCents: number, volFactor: number): number {
  const rel = BASE_REL_SPREAD * Math.pow(Math.max(volFactor, 0.15), 0.85);
  return Math.max(1, Math.round((priceCents * rel) / 2));
}

/** Allocate a reusable result object for `stepSecond`. */
export function makeSecondResult(subTicks: number): SecondResult {
  return {
    time: 0,
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    volume: 0,
    subPrices: new Int32Array(subTicks),
    subVolumes: new Float64Array(subTicks),
    halfSpreadCents: 1,
    volFactor: 1,
  };
}

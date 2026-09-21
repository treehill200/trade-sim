/**
 * Indicator maths.
 *
 * Every function writes into a caller-supplied output array and fills the
 * warm-up region with NaN, which is how the renderer knows not to draw a value
 * before the indicator has enough history to mean anything.
 *
 * Inputs are `ArrayLike<number>` so these work directly on the chart's
 * columnar candle storage without copying.
 */

export type Values = ArrayLike<number>;

/**
 * Simple moving average.
 *
 * NaN-aware: indicators are chained (Stochastic smooths a series that already
 * has a warm-up gap), and a running sum that swallows one NaN stays NaN
 * forever. Any NaN restarts the window instead.
 */
export function sma(src: Values, length: number, n: number, out: Float64Array): void {
  const len = Math.max(1, Math.floor(length));
  let sum = 0;
  let run = 0; // consecutive non-NaN values ending at i
  for (let i = 0; i < n; i++) {
    const v = src[i] as number;
    if (Number.isNaN(v)) {
      sum = 0;
      run = 0;
      out[i] = Number.NaN;
      continue;
    }
    sum += v;
    run += 1;
    if (run > len) {
      sum -= src[i - len] as number;
      run = len;
    }
    out[i] = run === len ? sum / len : Number.NaN;
  }
}

/**
 * Exponential moving average.
 *
 * Seeded with the simple average of the first `length` values, which is the
 * convention charting platforms use — starting from the first value alone
 * leaves a visible hook at the left edge.
 */
export function ema(src: Values, length: number, n: number, out: Float64Array): void {
  const len = Math.max(1, Math.floor(length));
  const k = 2 / (len + 1);
  let acc = 0;
  let prev = Number.NaN;
  for (let i = 0; i < n; i++) {
    const v = src[i] as number;
    if (i < len - 1) {
      acc += v;
      out[i] = Number.NaN;
      continue;
    }
    if (i === len - 1) {
      acc += v;
      prev = acc / len;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out[i] = prev;
  }
}

/**
 * Wilder's smoothing, the running average behind RSI and ATR.
 *
 * It is an EMA with k = 1/length rather than 2/(length+1); using a plain EMA
 * here would give numbers that disagree with every other platform.
 */
export function rma(src: Values, length: number, n: number, out: Float64Array): void {
  const len = Math.max(1, Math.floor(length));
  let acc = 0;
  let prev = Number.NaN;
  for (let i = 0; i < n; i++) {
    const v = src[i] as number;
    if (i < len - 1) {
      acc += v;
      out[i] = Number.NaN;
      continue;
    }
    if (i === len - 1) {
      acc += v;
      prev = acc / len;
    } else {
      prev = (prev * (len - 1) + v) / len;
    }
    out[i] = prev;
  }
}

/**
 * Rolling population standard deviation over the same window as `sma`.
 *
 * Computed from running sums of values and squares, so the cost does not grow
 * with the window length. The max() guards against a tiny negative from
 * floating-point cancellation when every value in the window is identical.
 */
export function rollingStdev(src: Values, length: number, n: number, out: Float64Array): void {
  const len = Math.max(1, Math.floor(length));
  let sum = 0;
  let sumSq = 0;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i] as number;
    if (Number.isNaN(v)) {
      sum = 0;
      sumSq = 0;
      run = 0;
      out[i] = Number.NaN;
      continue;
    }
    sum += v;
    sumSq += v * v;
    run += 1;
    if (run > len) {
      const old = src[i - len] as number;
      sum -= old;
      sumSq -= old * old;
      run = len;
    }
    if (run === len) {
      const mean = sum / len;
      out[i] = Math.sqrt(Math.max(0, sumSq / len - mean * mean));
    } else {
      out[i] = Number.NaN;
    }
  }
}

/**
 * Rolling maximum via a monotonic deque.
 *
 * The naive version is O(n * length), which is slow enough to notice on a
 * 43,000-candle series with a long Stochastic window; this is O(n).
 */
export function rollingMax(src: Values, length: number, n: number, out: Float64Array): void {
  rollingExtreme(src, length, n, out, true);
}

/** Rolling minimum, same approach as `rollingMax`. */
export function rollingMin(src: Values, length: number, n: number, out: Float64Array): void {
  rollingExtreme(src, length, n, out, false);
}

/**
 * Scratch buffer for the monotonic deque, reused across calls.
 *
 * Allocating a fresh index array on every pass means hundreds of kilobytes of
 * garbage several times a second on a long series, which shows up as dropped
 * frames when the collector runs.
 */
let dequeBuffer: Int32Array = new Int32Array(0);

function rollingExtreme(
  src: Values,
  length: number,
  n: number,
  out: Float64Array,
  wantMax: boolean,
): void {
  const len = Math.max(1, Math.floor(length));
  // Indices whose values are candidates for the extreme, kept monotonic.
  if (dequeBuffer.length < n) dequeBuffer = new Int32Array(Math.max(n, 1024));
  const deque = dequeBuffer;
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i] as number;
    while (tail > head) {
      const back = src[deque[tail - 1] as number] as number;
      if (wantMax ? back <= v : back >= v) tail -= 1;
      else break;
    }
    deque[tail] = i;
    tail += 1;
    if ((deque[head] as number) <= i - len) head += 1;
    out[i] = i >= len - 1 ? (src[deque[head] as number] as number) : Number.NaN;
  }
}

/** Fill an array with NaN. */
export function fillNaN(out: Float64Array, n: number): void {
  out.fill(Number.NaN, 0, n);
}

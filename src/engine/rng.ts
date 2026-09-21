/**
 * sfc32 — a small, fast, sequential PRNG.
 *
 * The market walk is inherently sequential (today's volatility depends on
 * yesterday's), so a counter-addressable hash buys us nothing there and costs
 * roughly 4x the time. Reproducibility instead comes from always starting the
 * walk at genesis with the same seed, plus checkpoints that store this
 * generator's four words so a resumed walk continues the identical sequence.
 */
export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number) {
    this.seedFrom(seed);
  }

  seedFrom(seed: number): void {
    // Scramble the seed into four words, then discard a short warm-up run.
    let x = seed | 0;
    const next = (): number => {
      x = (x + 0x9e3779b9) | 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 20; i++) this.next();
  }

  /** Uniform in [0, 1). */
  next(): number {
    const t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const r = (t + this.d) | 0;
    this.c = (this.c + r) | 0;
    return (r >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /**
   * Approximate standard normal (Irwin-Hall, n=4).
   *
   * Four uniforms sum to mean 2, variance 1/3; scaling by sqrt(3) gives unit
   * variance. It is trig-free, which matters when generating tens of millions
   * of shocks during the initial backfill.
   */
  normal(): number {
    const s = this.next() + this.next() + this.next() + this.next() - 2;
    return s * 1.7320508075688772;
  }

  /** Save the generator state so a walk can resume bit-identically. */
  save(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  restore(state: readonly [number, number, number, number]): void {
    this.a = state[0] | 0;
    this.b = state[1] | 0;
    this.c = state[2] | 0;
    this.d = state[3] | 0;
  }
}

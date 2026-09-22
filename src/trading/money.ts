/**
 * Exact arithmetic for money and quantity.
 *
 * Nothing here is a float. Dollar amounts are integer cents; quantities are
 * integer micro-units, where one million micro-units is one DAVID. Every
 * conversion between the two is written to stay inside the range where
 * JavaScript integers are exact, so a thousand round trips through a position
 * cannot leave a cent behind.
 */

/** An amount of USD, in whole cents. */
export type Cents = number;
/** A quantity of DAVID, in whole micro-units (1e-6 DAVID). */
export type Qty = number;

/** Micro-units per DAVID. */
export const QTY_SCALE = 1_000_000;
/** Cents per dollar. */
export const CENT_SCALE = 100;
/** Denominator for rates expressed in parts per million. */
export const PPM = 1_000_000;

/**
 * Notional value of `qty` at `priceCents`, signed like `qty`.
 *
 * The naive `price * qty / QTY_SCALE` overflows exact integer range for large
 * positions (a price near 4e6 cents times a quantity near 1e9 micro-units is
 * 4e15, uncomfortably close to 2^53). Splitting the quantity into whole and
 * fractional units keeps both products small and the result exact.
 */
export function notional(priceCents: Cents, qty: Qty): Cents {
  const sign = qty < 0 ? -1 : 1;
  const abs = Math.abs(qty);
  const whole = Math.floor(abs / QTY_SCALE);
  const frac = abs - whole * QTY_SCALE;
  const value = priceCents * whole + Math.round((priceCents * frac) / QTY_SCALE);
  return sign * value;
}

/** Largest quantity whose notional at `priceCents` does not exceed `value`. */
export function qtyFromNotional(value: Cents, priceCents: Cents): Qty {
  if (priceCents <= 0) return 0;
  return Math.floor((value * QTY_SCALE) / priceCents);
}

/** Apply a parts-per-million rate to an amount, rounding to the nearest cent. */
export function applyPpm(amount: Cents, ppm: number): Cents {
  return Math.round((amount * ppm) / PPM);
}

/** Convert a percentage (0.02 meaning 0.02%) to parts per million. */
export function percentToPpm(percent: number): number {
  return Math.round(percent * 10_000);
}

export function ppmToPercent(ppm: number): number {
  return ppm / 10_000;
}

/** Round a price to the nearest whole tick. */
export function roundToTick(priceCents: number, tickCents: number): Cents {
  if (tickCents <= 1) return Math.round(priceCents);
  return Math.round(priceCents / tickCents) * tickCents;
}

/** Quantity as a decimal number of DAVID, for display only. */
export function qtyToUnits(qty: Qty): number {
  return qty / QTY_SCALE;
}

/** Parse a decimal number of DAVID into whole micro-units. */
export function unitsToQty(units: number): Qty {
  if (!Number.isFinite(units)) return 0;
  return Math.round(units * QTY_SCALE);
}

/** Parse a decimal number of dollars into whole cents. */
export function dollarsToCents(dollars: number): Cents {
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * CENT_SCALE);
}

export function centsToDollars(cents: Cents): number {
  return cents / CENT_SCALE;
}

/**
 * Value of one tick for a given quantity.
 *
 * A tick is one cent of price, so this is simply the quantity expressed in
 * cents — but it is the number the order panel shows as "tick value", so it
 * gets a name.
 */
export function tickValue(qty: Qty, tickCents: number): Cents {
  return notional(tickCents, Math.abs(qty));
}

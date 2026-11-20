// Money arithmetic in integer cents. Binary floats can't hold most cent
// values exactly (0.29 is stored as 0.28999...), so float maths can round
// a half-cent the wrong way: $250,011.75 at 2% is $5,000.235, which
// rounds to $5,000.24, but float maths gives $5,000.23. The vendor's JSON
// contract carries amounts as plain decimal numbers, so convert at the
// edges: toCents on the way in, fromCents on the way out.

/** Basis points in 100% (1 bp = 0.01%). */
export const BASIS_POINTS_PER_UNIT = 10_000;

/**
 * True when the amount is a whole number of cents. Allows a few ULPs of
 * float error rather than requiring an exact integer, since 0.29 * 100 is
 * 28.999999999999996. (Zod's multipleOf(0.01) accepts 0.0000001, so it
 * isn't enough.)
 */
export function hasWholeCents(amount: number): boolean {
  const cents = amount * 100;
  return Math.abs(cents - Math.round(cents)) <= 4 * Number.EPSILON * Math.max(1, Math.abs(cents));
}

/** Dollars to integer cents. Exact for any amount that passes hasWholeCents. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Integer cents to dollars, for the JSON contract and display. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Applies a rate in basis points to an amount in cents, rounding half up
 * to the nearest cent. Pure integer maths, so it's exact: the product
 * stays a safe integer for any loan we accept ($100M at 100% is 1e14).
 */
export function applyBasisPoints(cents: number, basisPoints: number): number {
  const product = cents * basisPoints;
  const exact = Number.isSafeInteger(cents) && Number.isSafeInteger(basisPoints) && Number.isSafeInteger(product);
  if (!exact || cents < 0 || basisPoints < 0) {
    throw new RangeError(`Can't apply ${basisPoints} bp to ${cents} cents exactly.`);
  }
  const whole = Math.floor(product / BASIS_POINTS_PER_UNIT);
  return product % BASIS_POINTS_PER_UNIT >= BASIS_POINTS_PER_UNIT / 2 ? whole + 1 : whole;
}

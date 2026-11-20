// Money arithmetic in integer cents. Binary floats can't hold most cent
// values exactly (0.29 is stored as 0.28999...), so float maths can round
// a half-cent the wrong way: $250,011.75 at 2% is $5,000.235, which
// rounds to $5,000.24, but float maths gives $5,000.23. So amounts travel
// as decimal strings ("250011.75") and never become float dollars:
// parseCents on the way in, formatCents on the way out.

/** Basis points in 100% (1 bp = 0.01%). */
export const BASIS_POINTS_PER_UNIT = 10_000;

/** A non-negative amount with up to two decimal places, e.g. "250000" or "250011.75". */
const DECIMAL_AMOUNT = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * A decimal string to integer cents, read digit by digit so it's exact.
 * Undefined if it isn't a plain amount with at most two decimal places,
 * or is too large to count in cents exactly.
 */
export function parseCents(amount: string): number | undefined {
  const match = DECIMAL_AMOUNT.exec(amount);
  if (match === null) return undefined;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  // A whole part too big to be exact also pushes cents past the safe range.
  return Number.isSafeInteger(cents) ? cents : undefined;
}

/** Integer cents to a decimal string with two places, for the JSON contract. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`Can't format ${cents} cents exactly.`);
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
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

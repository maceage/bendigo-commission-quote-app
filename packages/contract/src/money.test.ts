import { describe, expect, it } from "vitest";
import { MAX_LOAN_AMOUNT } from "./domain";
import { applyBasisPoints, fromCents, hasWholeCents, toCents } from "./money";

/** Reference result in BigInt: exact by construction, rounded half up. */
function exactCommission(cents: number, basisPoints: number): number {
  const product = BigInt(cents) * BigInt(basisPoints);
  return Number((product + 5_000n) / 10_000n);
}

/** Deterministic pseudo-random integers, so a failure always reproduces. */
function* seededInts(seed: number, max: number): Generator<number> {
  let state = seed;
  for (;;) {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    yield Math.floor((state / 2 ** 31) * max) + 1;
  }
}

describe("toCents / fromCents", () => {
  it.each([
    [0.01, 1],
    [0.29, 29], // 0.29 * 100 is 28.999999999999996 in floats
    [19.99, 1999],
    [250_011.75, 25_001_175],
    [MAX_LOAN_AMOUNT, 10_000_000_000],
  ])("converts $%f to %i cents and back", (dollars, cents) => {
    expect(toCents(dollars)).toBe(cents);
    expect(fromCents(cents)).toBe(dollars);
  });
});

describe("applyBasisPoints", () => {
  it.each([
    // Half-cent cases that float maths (Math.round(amount * rate * 100)) rounds down.
    { dollars: 7.25, bp: 200, expected: 15 }, // 2% = 14.5c
    { dollars: 250_011.75, bp: 200, expected: 500_024 }, // 2% = $5,000.235
    { dollars: 250_003.75, bp: 600, expected: 1_500_023 }, // 6% = $15,000.225
    // Ordinary cases.
    { dollars: 250_000, bp: 350, expected: 875_000 }, // 3.5% = $8,750
    { dollars: 0.01, bp: 350, expected: 0 }, // 0.035c rounds down
    { dollars: MAX_LOAN_AMOUNT, bp: 600, expected: 600_000_000 }, // $6M
  ])("$dollars at $bp bp is $expected cents", ({ dollars, bp, expected }) => {
    expect(applyBasisPoints(toCents(dollars), bp)).toBe(expected);
  });

  it("matches exact BigInt arithmetic across the whole loan range", () => {
    const amounts = seededInts(42, toCents(MAX_LOAN_AMOUNT));
    for (let i = 0; i < 20_000; i++) {
      const cents = amounts.next().value;
      for (const bp of [200, 350, 600]) {
        expect(applyBasisPoints(cents, bp)).toBe(exactCommission(cents, bp));
      }
    }
  });

  it("refuses inputs it can't compute exactly", () => {
    expect(() => applyBasisPoints(-100, 200)).toThrow(RangeError);
    expect(() => applyBasisPoints(Number.MAX_SAFE_INTEGER, 200)).toThrow(RangeError);
    expect(() => applyBasisPoints(100.5, 200)).toThrow(RangeError);
  });
});

describe("hasWholeCents", () => {
  it.each([0.01, 0.29, 19.99, 1234.56, 99_999_999.99, MAX_LOAN_AMOUNT])("accepts %f", (amount) => {
    expect(hasWholeCents(amount)).toBe(true);
  });

  it.each([0.001, 1.005, 12.345, 0.0000001, 99_999_999.999])("rejects %f", (amount) => {
    expect(hasWholeCents(amount)).toBe(false);
  });
});

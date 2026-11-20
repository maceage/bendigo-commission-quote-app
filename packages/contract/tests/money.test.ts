import { describe, expect, it } from "vitest";
import { MAX_LOAN_AMOUNT } from "../src/domain";
import { applyBasisPoints, formatCents, parseCents } from "../src/money";

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

describe("parseCents / formatCents", () => {
  it.each([
    ["0.01", 1, "0.01"],
    ["0.29", 29, "0.29"], // 0.29 * 100 is 28.999999999999996 in floats
    ["19.9", 1990, "19.90"],
    ["250011.75", 25_001_175, "250011.75"],
    ["250000", 25_000_000, "250000.00"],
    ["0", 0, "0.00"],
    ["100000000", 10_000_000_000, "100000000.00"],
  ])("reads %s as %i cents, written back as %s", (amount, cents, written) => {
    expect(parseCents(amount)).toBe(cents);
    expect(formatCents(cents)).toBe(written);
  });

  it.each(["", "abc", "-1", "+1", "1e5", "1,000", " 1", "1.", ".5", "1.005", "0.0000001", "9".repeat(20)])(
    "won't read %j as an amount",
    (amount) => {
      expect(parseCents(amount)).toBeUndefined();
    },
  );

  it("refuses to write cents it can't represent exactly", () => {
    expect(() => formatCents(-1)).toThrow(RangeError);
    expect(() => formatCents(1.5)).toThrow(RangeError);
    expect(() => formatCents(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe("applyBasisPoints", () => {
  it.each([
    // Half-cent cases that float maths (Math.round(amount * rate * 100)) rounds down.
    { amount: "7.25", bp: 200, expected: 15 }, // 2% = 14.5c
    { amount: "250011.75", bp: 200, expected: 500_024 }, // 2% = $5,000.235
    { amount: "250003.75", bp: 600, expected: 1_500_023 }, // 6% = $15,000.225
    // Ordinary cases.
    { amount: "250000", bp: 350, expected: 875_000 }, // 3.5% = $8,750
    { amount: "0.01", bp: 350, expected: 0 }, // 0.035c rounds down
    { amount: String(MAX_LOAN_AMOUNT), bp: 600, expected: 600_000_000 }, // $6M
  ])("$amount at $bp bp is $expected cents", ({ amount, bp, expected }) => {
    expect(applyBasisPoints(parseCents(amount)!, bp)).toBe(expected);
  });

  it("matches exact BigInt arithmetic across the whole loan range", () => {
    const amounts = seededInts(42, MAX_LOAN_AMOUNT * 100);
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

// The commission maths itself, without HTTP. Amounts here are ones that
// the old float calculation (Math.round(amount * rate * 100) / 100)
// rounded a half-cent down.

import { describe, it, expect } from "vitest";
import { generateQuote, termLoadingBasisPoints } from "../../src/services/quote-engine";

describe("generateQuote", () => {
  it.each([
    { loanAmount: "250011.75", riskBand: "LOW", commissionRate: 0.02, totalCommission: "5000.24" },
    { loanAmount: "250003.75", riskBand: "HIGH", commissionRate: 0.06, totalCommission: "15000.23" },
    { loanAmount: "7.25", riskBand: "LOW", commissionRate: 0.02, totalCommission: "0.15" },
    { loanAmount: "250000", riskBand: "MEDIUM", commissionRate: 0.035, totalCommission: "8750.00" },
    { loanAmount: "100000000", riskBand: "HIGH", commissionRate: 0.06, totalCommission: "6000000.00" },
  ])(
    "$loanAmount at $riskBand is $totalCommission, rounded half up to the cent",
    ({ loanAmount, riskBand, commissionRate, totalCommission }) => {
      const quote = generateQuote({ loanAmount, loanTermInMonths: 36, riskBand });
      expect(quote.commissionRate).toBe(commissionRate);
      expect(quote.totalCommission).toBe(totalCommission);
    },
  );

  it.each([
    { loanTermInMonths: 1, riskBand: "LOW", commissionRate: 0.02, totalCommission: "5000.00" },
    { loanTermInMonths: 60, riskBand: "LOW", commissionRate: 0.02, totalCommission: "5000.00" },
    { loanTermInMonths: 61, riskBand: "LOW", commissionRate: 0.0225, totalCommission: "5625.00" },
    { loanTermInMonths: 240, riskBand: "MEDIUM", commissionRate: 0.0375, totalCommission: "9375.00" },
    { loanTermInMonths: 241, riskBand: "MEDIUM", commissionRate: 0.04, totalCommission: "10000.00" },
    { loanTermInMonths: 600, riskBand: "HIGH", commissionRate: 0.065, totalCommission: "16250.00" },
  ])(
    "$250,000 over $loanTermInMonths months at $riskBand is $commissionRate",
    ({ loanTermInMonths, riskBand, commissionRate, totalCommission }) => {
      const quote = generateQuote({ loanAmount: "250000", loanTermInMonths, riskBand });
      expect(quote.commissionRate).toBe(commissionRate);
      expect(quote.totalCommission).toBe(totalCommission);
    },
  );

  it("never lowers the rate as the term gets longer", () => {
    for (let months = 2; months <= 600; months++) {
      expect(termLoadingBasisPoints(months)).toBeGreaterThanOrEqual(termLoadingBasisPoints(months - 1));
    }
  });
});

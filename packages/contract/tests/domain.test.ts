import { describe, expect, it } from "vitest";
import { QuoteRequestSchema, QuoteResponseSchema } from "../src/domain";

const request = (loanAmount: unknown) => ({ loanAmount, loanTermInMonths: 36, riskBand: "MEDIUM" });

/** The first message the schema gives for a loan amount, as the form would show it. */
function loanAmountMessage(loanAmount: unknown): string | undefined {
  const parsed = QuoteRequestSchema.safeParse(request(loanAmount));
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

describe("QuoteRequestSchema loanAmount", () => {
  it.each(["0.01", "250000", "250000.5", "250011.75", "100000000"])("accepts %j", (amount) => {
    expect(loanAmountMessage(amount)).toBeUndefined();
  });

  it.each([
    [undefined, "Enter a loan amount."],
    ["", "Enter a loan amount."],
    [250000, "Loan amount must be a decimal string."], // a JSON number would be parsed as a float
    ["abc", "Loan amount must be a number."],
    ["1e5", "Loan amount must be a number."],
    ["1000.005", "Loan amount can't include fractions of a cent."],
    ["0.0000001", "Loan amount can't include fractions of a cent."],
    ["0", "Loan amount must be greater than zero."],
    ["-100", "Loan amount must be greater than zero."],
    ["100000000.01", "Loan amount must be $100,000,000 or less."],
    ["9".repeat(30), "Loan amount must be $100,000,000 or less."],
  ])("rejects %j: %s", (amount, message) => {
    expect(loanAmountMessage(amount)).toBe(message);
  });
});

describe("QuoteResponseSchema totalCommission", () => {
  const response = (totalCommission: unknown) => ({ quoteId: "Q-1", commissionRate: 0.035, totalCommission });

  it.each(["8750.00", "8750", "0.15"])("accepts %j", (amount) => {
    expect(QuoteResponseSchema.safeParse(response(amount)).success).toBe(true);
  });

  it.each([8750, "-1.00", "8750.001", "lots"])("rejects %j", (amount) => {
    expect(QuoteResponseSchema.safeParse(response(amount)).success).toBe(false);
  });
});

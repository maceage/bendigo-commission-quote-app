import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { QuoteResponse } from "@commission-quote/contract";
import { QuoteResult } from "../../src/components/QuoteResult";

/** The value shown beside a label in the result's definition list. */
function valueFor(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent;
}

function renderQuote(overrides: Partial<QuoteResponse> = {}) {
  render(
    <QuoteResult quote={{ quoteId: "Q-12345", commissionRate: 0.035, totalCommission: "8750.00", ...overrides }} />,
  );
}

describe("QuoteResult", () => {
  it("shows the commission in AUD, the rate as a percentage, and the quote reference", () => {
    renderQuote();
    expect(valueFor("Total commission")).toBe("$8,750.00");
    expect(valueFor("Commission rate")).toBe("3.5%");
    expect(valueFor("Quote reference")).toBe("Q-12345");
  });

  // The contract's rate is a 0-1 fraction; a mix-up here would show
  // "350%" or "0.04%" and nothing else would catch it.
  it.each([
    [0.02, "2.0%"],
    [0.06, "6.0%"],
    [0.0625, "6.25%"],
  ])("formats a rate of %f as %s", (commissionRate, shown) => {
    renderQuote({ commissionRate });
    expect(valueFor("Commission rate")).toBe(shown);
  });

  it.each([
    ["5000.24", "$5,000.24"],
    ["0.15", "$0.15"],
    ["6000000.00", "$6,000,000.00"],
    // Past 2^53 cents a float would round this to …409.94; the string is shown exactly.
    ["90071992547409.93", "$90,071,992,547,409.93"],
  ])("formats a commission of %s as %s", (totalCommission, shown) => {
    renderQuote({ totalCommission });
    expect(valueFor("Total commission")).toBe(shown);
  });

  it("announces the quote to screen readers when it arrives", () => {
    renderQuote();
    expect(screen.getByRole("heading", { name: "Your commission quote" }).parentElement).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });
});

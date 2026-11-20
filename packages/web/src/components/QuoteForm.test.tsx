import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuoteForm } from "./QuoteForm";

function setup(loading = false) {
  const onSubmit = vi.fn();
  render(<QuoteForm onSubmit={onSubmit} loading={loading} />);
  return {
    onSubmit,
    user: userEvent.setup(),
    amount: screen.getByLabelText("Loan amount ($)"),
    term: screen.getByLabelText("Loan term (months)"),
    band: screen.getByLabelText("Risk band"),
    submit: screen.getByRole("button"),
  };
}

describe("QuoteForm", () => {
  it("submits real numbers, not strings", async () => {
    const { user, amount, term, band, submit, onSubmit } = setup();
    await user.type(amount, "250000.50");
    await user.type(term, "36");
    await user.selectOptions(band, "HIGH");
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith({ loanAmount: 250000.5, loanTermInMonths: 36, riskBand: "HIGH" });
  });

  it("shows field errors for blank fields and doesn't submit", async () => {
    const { user, submit, onSubmit, amount } = setup();
    await user.click(submit);

    expect(screen.getByText("Enter a loan amount.")).toBeInTheDocument();
    expect(screen.getByText("Enter a loan term.")).toBeInTheDocument();
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("enforces the same limits as the backend schema", async () => {
    const { user, amount, term, submit, onSubmit } = setup();
    await user.type(amount, "200000000");
    await user.type(term, "601");
    await user.click(submit);

    expect(screen.getByText("Loan amount must be $100,000,000 or less.")).toBeInTheDocument();
    expect(screen.getByText("Loan term must be 600 months (50 years) or fewer.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a fractional loan term", async () => {
    const { user, amount, term, submit } = setup();
    await user.type(amount, "1000");
    await user.type(term, "12.5");
    await user.click(submit);
    expect(screen.getByText("Loan term must be a whole number of months.")).toBeInTheDocument();
  });

  it("rejects a loan amount with fractions of a cent", async () => {
    const { user, amount, term, submit, onSubmit } = setup();
    await user.type(amount, "1000.005");
    await user.type(term, "12");
    await user.click(submit);
    expect(screen.getByText("Loan amount can't include fractions of a cent.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears a field's error as soon as it's edited", async () => {
    const { user, amount, submit } = setup();
    await user.click(submit);
    expect(screen.getByText("Enter a loan amount.")).toBeInTheDocument();

    await user.type(amount, "5");
    expect(screen.queryByText("Enter a loan amount.")).not.toBeInTheDocument();
  });

  it("disables everything while loading", () => {
    const { amount, term, band, submit } = setup(true);
    for (const el of [amount, term, band, submit]) expect(el).toBeDisabled();
    expect(submit).toHaveTextContent("Generating quote…");
  });
});

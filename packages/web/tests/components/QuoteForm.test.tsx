import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuoteForm } from "../../src/components/QuoteForm";

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
  it("submits the term as a number and the amount as the decimal string typed", async () => {
    const { user, amount, term, band, submit, onSubmit } = setup();
    await user.type(amount, "250000.50");
    await user.type(term, "36");
    await user.selectOptions(band, "HIGH");
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith({ loanAmount: "250000.50", loanTermInMonths: 36, riskBand: "HIGH" });
  });

  it("accepts an amount written with a dollar sign, commas and spaces", async () => {
    const { user, amount, term, submit, onSubmit } = setup();
    await user.type(amount, " $250,000.50 ");
    await user.type(term, "36");
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith({ loanAmount: "250000.50", loanTermInMonths: 36, riskBand: "MEDIUM" });
  });

  it("says an amount that isn't a number isn't one, rather than that it's blank", async () => {
    const { user, amount, term, submit, onSubmit } = setup();
    await user.type(amount, "250k");
    await user.type(term, "36");
    await user.click(submit);

    expect(screen.getByText("Loan amount must be a number.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
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

  it("shows the schema's message for a risk band that isn't one of the options", async () => {
    const { user, amount, term, band, submit, onSubmit } = setup();
    await user.type(amount, "1000");
    await user.type(term, "12");
    // No option has this value, so the select reports "" (e.g. a tampered DOM).
    fireEvent.change(band, { target: { value: "EXTREME" } });
    await user.click(submit);

    expect(screen.getByText("Choose a risk band: LOW, MEDIUM or HIGH.")).toBeInTheDocument();
    expect(band).toHaveAttribute("aria-invalid", "true");
    expect(band).toHaveAttribute("aria-describedby", "riskBand-error");
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

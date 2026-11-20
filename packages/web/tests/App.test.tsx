// The whole page as a user drives it, with only fetch stubbed: the
// brief's UI requirements (form, Generate Quote, result display, loading
// state, error messages) checked together rather than piece by piece.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";

const QUOTE = { quoteId: "Q-12345", commissionRate: 0.035, totalCommission: "8750.00" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch whose responses the test releases one at a time. */
function controllableFetch() {
  const pending: ((response: Response) => void)[] = [];
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    respond: (response: Response) => {
      const resolve = pending.shift();
      if (resolve === undefined) throw new Error("no request is waiting for a response");
      resolve(response);
    },
  };
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Loan amount ($)"), "250000");
  await user.type(screen.getByLabelText("Loan term (months)"), "36");
  await user.click(screen.getByRole("button", { name: "Generate Quote" }));
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows a loading state, then the quote", async () => {
    const { fetchMock, respond } = controllableFetch();
    render(<App />);
    await fillAndSubmit();

    const button = screen.getByRole("button", { name: "Generating quote…" });
    expect(button).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledOnce();

    respond(json(QUOTE));

    expect(await screen.findByText("$8,750.00")).toBeInTheDocument();
    expect(screen.getByText("3.5%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Quote" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error with its reference, and a retry replaces it with the quote", async () => {
    const { respond } = controllableFetch();
    render(<App />);
    const user = await fillAndSubmit();

    respond(
      json({ code: "SERVICE_UNAVAILABLE", message: "Vendor temporarily unavailable.", requestId: "req-42" }, 503),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Quote service unavailable");
    expect(alert).toHaveTextContent("Vendor temporarily unavailable.");
    expect(alert).toHaveTextContent("Reference: req-42");
    expect(screen.queryByText("Your commission quote")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Generate Quote" }));
    respond(json(QUOTE));

    expect(await screen.findByText("$8,750.00")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never calls the API for invalid input", async () => {
    const { fetchMock } = controllableFetch();
    render(<App />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Generate Quote" }));

    expect(screen.getByText("Enter a loan amount.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

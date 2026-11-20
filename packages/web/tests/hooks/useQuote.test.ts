import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { QuoteRequest, QuoteResponse } from "@commission-quote/contract";
import type { QuoteResult } from "../../src/api/quoteApi";
import { useQuote } from "../../src/hooks/useQuote";

vi.mock("../../src/api/quoteApi", () => ({ requestQuote: vi.fn() }));
const { requestQuote } = await import("../../src/api/quoteApi");
const requestQuoteMock = vi.mocked(requestQuote);

const REQUEST: QuoteRequest = { loanAmount: "250000", loanTermInMonths: 36, riskBand: "MEDIUM" };
const quote = (id: string): QuoteResponse => ({
  quoteId: `${id}1111111-1111-4111-8111-111111111111`,
  commissionRate: 0.035,
  totalCommission: "8750.00",
});

/** A requestQuote call we resolve by hand; rejects like fetch when aborted. */
function deferred() {
  let resolve!: (r: QuoteResult) => void;
  requestQuoteMock.mockImplementationOnce(
    (_req, opts) =>
      new Promise<QuoteResult>((res, rej) => {
        resolve = res;
        opts?.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")));
      }),
  );
  return { resolve: (r: QuoteResult) => resolve(r) };
}

afterEach(() => {
  requestQuoteMock.mockReset();
});

describe("useQuote", () => {
  it("goes idle -> loading -> success", async () => {
    const call = deferred();
    const { result } = renderHook(() => useQuote());
    expect(result.current.state).toEqual({ status: "idle" });

    let done!: Promise<void>;
    act(() => {
      done = result.current.generate(REQUEST);
    });
    expect(result.current.state).toEqual({ status: "loading" });

    await act(async () => {
      call.resolve({ ok: true, quote: quote("a") });
      await done;
    });
    expect(result.current.state).toEqual({ status: "success", quote: quote("a") });
  });

  it("goes to error with the envelope on failure", async () => {
    requestQuoteMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "VENDOR_TIMEOUT", message: "Vendor timed out." },
    });
    const { result } = renderHook(() => useQuote());
    await act(() => result.current.generate(REQUEST));
    expect(result.current.state).toEqual({
      status: "error",
      error: { code: "VENDOR_TIMEOUT", message: "Vendor timed out." },
    });
  });

  it("lets the NEWEST request win when responses arrive out of order", async () => {
    const first = deferred();
    const second = deferred();
    const { result } = renderHook(() => useQuote());

    let p1!: Promise<void>, p2!: Promise<void>;
    act(() => {
      p1 = result.current.generate(REQUEST);
    });
    act(() => {
      p2 = result.current.generate(REQUEST);
    });

    // Newer request resolves; the first was aborted when it was superseded.
    await act(async () => {
      second.resolve({ ok: true, quote: quote("b") });
      first.resolve({ ok: true, quote: quote("a") });
      await Promise.all([p1, p2]);
    });

    expect(result.current.state).toEqual({ status: "success", quote: quote("b") });
    expect(requestQuoteMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("ignores a superseded request that still answers, rather than rejecting on abort", async () => {
    // The abort can land after the body has been read, so requestQuote
    // resolves for a request that is no longer the newest.
    let resolveFirst!: (r: QuoteResult) => void;
    requestQuoteMock.mockImplementationOnce(() => new Promise<QuoteResult>((res) => (resolveFirst = res)));
    const second = deferred();
    const { result } = renderHook(() => useQuote());

    let p1!: Promise<void>, p2!: Promise<void>;
    act(() => {
      p1 = result.current.generate(REQUEST);
    });
    act(() => {
      p2 = result.current.generate(REQUEST);
    });

    await act(async () => {
      second.resolve({ ok: true, quote: quote("b") });
      await p2;
      resolveFirst({ ok: true, quote: quote("a") });
      await p1;
    });

    expect(result.current.state).toEqual({ status: "success", quote: quote("b") });
  });

  it("aborts the in-flight request on unmount", async () => {
    deferred();
    const { result, unmount } = renderHook(() => useQuote());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.generate(REQUEST);
    });
    unmount();
    await waitFor(() => expect(requestQuoteMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true));
    await expect(pending).resolves.toBeUndefined();
  });

  it("rethrows an unexpected error rather than swallowing it", async () => {
    // requestQuote turns every expected failure into a result, and throws
    // only when its caller aborts, so a throw here would be a bug.
    const bug = new TypeError("Cannot read properties of undefined");
    requestQuoteMock.mockRejectedValueOnce(bug);
    const { result } = renderHook(() => useQuote());

    await expect(act(() => result.current.generate(REQUEST))).rejects.toBe(bug);
  });
});

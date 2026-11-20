import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuoteRequest } from "@commission-quote/contract";
import { requestQuote } from "../../src/api/quoteApi";

const REQUEST: QuoteRequest = { loanAmount: "250000", loanTermInMonths: 36, riskBand: "MEDIUM" };
const QUOTE = { quoteId: "11111111-1111-4111-8111-111111111111", commissionRate: 0.035, totalCommission: "8750.00" };

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestQuote", () => {
  it("POSTs the request to the same-origin API and returns the quote", async () => {
    const fetchMock = stubFetch(async () => json(QUOTE));
    expect(await requestQuote(REQUEST)).toEqual({ ok: true, quote: QUOTE });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/quotes");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(REQUEST);
  });

  it("passes through a valid error envelope from the backend", async () => {
    stubFetch(async () => json({ code: "VENDOR_TIMEOUT", message: "Vendor timed out." }, 504));
    expect(await requestQuote(REQUEST)).toEqual({
      ok: false,
      error: { code: "VENDOR_TIMEOUT", message: "Vendor timed out." },
    });
  });

  it("rejects an error envelope with an unknown code", async () => {
    stubFetch(async () => json({ code: "SOMETHING_NEW", message: "??" }, 500));
    const result = await requestQuote(REQUEST);
    expect(result).toEqual({
      ok: false,
      error: { code: "VENDOR_ERROR", message: "Quote request failed (500). Please try again." },
    });
  });

  it("tolerates a non-JSON error body (e.g. a proxy's HTML 502 page)", async () => {
    stubFetch(async () => new Response("<html>Bad Gateway</html>", { status: 502 }));
    const result = await requestQuote(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VENDOR_ERROR");
  });

  it("rejects a 200 whose body doesn't match the quote schema", async () => {
    stubFetch(async () => json({ totalCommission: "lots" }));
    const result = await requestQuote(REQUEST);
    expect(result).toEqual({
      ok: false,
      error: { code: "VENDOR_ERROR", message: "Received an invalid quote response." },
    });
  });

  it("treats a 200 whose body isn't JSON as an invalid quote, not an unreachable service", async () => {
    stubFetch(async () => new Response("<html>Welcome</html>", { status: 200 }));
    expect(await requestQuote(REQUEST)).toEqual({
      ok: false,
      error: { code: "VENDOR_ERROR", message: "Received an invalid quote response." },
    });
  });

  it("maps a connection dropped mid-body to SERVICE_UNAVAILABLE, not an invalid quote", async () => {
    const dropped = new ReadableStream({ start: (controller) => controller.error(new TypeError("terminated")) });
    stubFetch(async () => new Response(dropped, { status: 200 }));
    const result = await requestQuote(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("maps a network failure to SERVICE_UNAVAILABLE", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await requestQuote(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("gives up with VENDOR_TIMEOUT when the backend never answers", async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const result = await requestQuote(REQUEST, { timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VENDOR_TIMEOUT");
  });

  it("rethrows when the CALLER aborts, so the caller can ignore it", async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const controller = new AbortController();
    const pending = requestQuote(REQUEST, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });
});

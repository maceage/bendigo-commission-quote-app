// Route-level behaviour with a STUBBED QuoteProvider — no vendor,
// no sockets to a vendor, fully deterministic. This is what the
// QuoteProvider interface exists for.

import { describe, it, expect, afterEach, vi } from "vitest";
import type { QuoteError, QuoteRequest, QuoteResponse } from "@commission-quote/contract";
import { createApp } from "../app";
import { VendorClientError } from "../services/vendor-client";
import { startApp, loanPayload } from "./test-server";

let harness: Awaited<ReturnType<typeof startApp>> | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  vi.restoreAllMocks();
});

const QUOTE: QuoteResponse = {
  quoteId: "11111111-1111-4111-8111-111111111111",
  commissionRate: 0.035,
  totalCommission: 8750,
};

function stubProvider(impl: (req: QuoteRequest) => Promise<QuoteResponse>) {
  return { generateQuote: vi.fn(impl) };
}

async function post(body: string) {
  return fetch(`${harness!.url}/api/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function errorBody(res: Response): Promise<QuoteError> {
  return (await res.json()) as QuoteError;
}

describe("POST /api/quotes", () => {
  it("returns 200 with the quote on success", async () => {
    const provider = stubProvider(async () => QUOTE);
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post(loanPayload());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(QUOTE);
    expect(provider.generateQuote).toHaveBeenCalledOnce();
  });

  it("passes the VALIDATED request to the provider, not raw body", async () => {
    const provider = stubProvider(async () => QUOTE);
    harness = await startApp(createApp({ quoteService: provider }));

    await post(loanPayload({ extraField: "should be stripped" }));
    expect(provider.generateQuote).toHaveBeenCalledWith({
      loanAmount: 250000,
      loanTermInMonths: 36,
      riskBand: "MEDIUM",
    });
  });

  it.each([
    { field: "loanAmount", value: -100 },
    { field: "loanAmount", value: 1000.005 }, // fraction of a cent
    { field: "loanAmount", value: 0.0000001 }, // fraction of a cent, prints as 1e-7
    { field: "riskBand", value: "EXTREME" },
    { field: "loanTermInMonths", value: 12.5 }, // non-integer
    { field: "loanTermInMonths", value: 601 }, // over the cap
  ])("returns 400 VALIDATION_ERROR for bad $field ($value)", async ({ field, value }) => {
    const provider = stubProvider(async () => QUOTE);
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post(loanPayload({ [field]: value }));
    expect(res.status).toBe(400);

    const body = await errorBody(res);
    expect(body.code).toBe("VALIDATION_ERROR");
    // Message must be user-displayable, not a Zod dump.
    expect(body.message).toMatch(/^[A-Z].*\.$/);

    // Validation happens BEFORE the vendor is touched — no wasted call.
    expect(provider.generateQuote).not.toHaveBeenCalled();
  });

  it.each([
    { code: "VENDOR_TIMEOUT", expectedStatus: 504 },
    { code: "SERVICE_UNAVAILABLE", expectedStatus: 503 },
    { code: "VENDOR_ERROR", expectedStatus: 502 },
  ] as const)("maps $code to $expectedStatus", async ({ code, expectedStatus }) => {
    const provider = stubProvider(() => Promise.reject(new VendorClientError(code, "vendor blew up")));
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post(loanPayload());
    expect(res.status).toBe(expectedStatus);
    expect(await errorBody(res)).toEqual({ code, message: "vendor blew up" });
  });

  it("returns 500 INTERNAL_ERROR with a safe message when the provider throws something untyped", async () => {
    // Silence the deliberate alarm for THIS test — and assert it fired.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const provider = stubProvider(() => Promise.reject(new Error("secret stack details")));
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post(loanPayload());
    expect(res.status).toBe(500);

    const body = await errorBody(res);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret stack details");
    expect(errorSpy).toHaveBeenCalledWith("[quote-service] unexpected failure:", expect.any(Error));
  });

  it("survives an error that merely LOOKS typed (e.g. a DOMException with a numeric code)", async () => {
    // Regression: duck-typing on `"code" in err` once let this through
    // to res.status(undefined), which threw inside an async handler.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const lookalike = Object.assign(new Error("The operation timed out."), { code: 23 });
    const provider = stubProvider(() => Promise.reject(lookalike));
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post(loanPayload());
    expect(res.status).toBe(500);
    expect((await errorBody(res)).code).toBe("INTERNAL_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for a malformed JSON body", async () => {
    const provider = stubProvider(async () => QUOTE);
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect((await errorBody(res)).code).toBe("VALIDATION_ERROR");
  });

  it("returns 413 for an oversized body", async () => {
    const provider = stubProvider(async () => QUOTE);
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post(loanPayload({ padding: "x".repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(provider.generateQuote).not.toHaveBeenCalled();
  });
});

describe("GET /healthz", () => {
  it("reports ok", async () => {
    harness = await startApp(createApp({ quoteService: stubProvider(async () => QUOTE) }));
    const res = await fetch(`${harness.url}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

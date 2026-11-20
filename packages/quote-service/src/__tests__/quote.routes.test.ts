// Route-level behaviour with a STUBBED QuoteProvider — no vendor,
// no sockets to a vendor, fully deterministic. This is what the
// QuoteProvider interface exists for.

import { describe, it, expect, afterEach, vi } from "vitest";
import { REQUEST_ID_HEADER, type QuoteError, type QuoteRequest, type QuoteResponse } from "@commission-quote/contract";
import { createApp } from "../app";
import { VendorClientError } from "../services/vendor-client";
import { startApp, loanPayload, captureLogs } from "./test-server";

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

async function post(body: string, headers: Record<string, string> = {}) {
  return fetch(`${harness!.url}/api/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
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

  it("gives every response a request ID, and puts it in error bodies", async () => {
    harness = await startApp(createApp({ quoteService: stubProvider(async () => QUOTE) }));

    const ok = await post(loanPayload());
    expect(ok.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);

    const bad = await post(loanPayload({ loanAmount: -1 }));
    const id = bad.headers.get(REQUEST_ID_HEADER);
    expect(id).not.toBe(ok.headers.get(REQUEST_ID_HEADER));
    expect((await errorBody(bad)).requestId).toBe(id);
  });

  it("reuses a well-formed incoming request ID", async () => {
    harness = await startApp(createApp({ quoteService: stubProvider(async () => QUOTE) }));
    const res = await post(loanPayload(), { [REQUEST_ID_HEADER]: "upstream-abc_123" });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("upstream-abc_123");
  });

  it("replaces an incoming request ID that isn't a short plain token", async () => {
    harness = await startApp(createApp({ quoteService: stubProvider(async () => QUOTE) }));
    const res = await post(loanPayload(), { [REQUEST_ID_HEADER]: "<script>alert(1)</script>" });
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("passes the VALIDATED request to the provider, not raw body", async () => {
    const provider = stubProvider(async () => QUOTE);
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post(loanPayload({ extraField: "should be stripped" }));
    expect(provider.generateQuote).toHaveBeenCalledWith(
      { loanAmount: 250000, loanTermInMonths: 36, riskBand: "MEDIUM" },
      // The request's ID and logger travel with it, for the vendor call's logs.
      { requestId: res.headers.get(REQUEST_ID_HEADER), log: expect.anything() },
    );
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
    expect(await errorBody(res)).toEqual({
      code,
      message: "vendor blew up",
      requestId: res.headers.get(REQUEST_ID_HEADER),
    });
  });

  it("returns 500 INTERNAL_ERROR with a safe message when the provider throws something untyped", async () => {
    const { logger, lines } = captureLogs();
    const provider = stubProvider(() => Promise.reject(new Error("secret stack details")));
    harness = await startApp(createApp({ quoteService: provider, logger }));

    const res = await post(loanPayload());
    expect(res.status).toBe(500);

    const body = await errorBody(res);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret stack details");
    // The details go to the log instead, under the ID the user was given.
    expect(lines).toContainEqual(
      expect.objectContaining({
        msg: "unexpected failure",
        reqId: body.requestId,
        err: expect.objectContaining({ message: "secret stack details" }),
      }),
    );
  });

  it("survives an error that merely LOOKS typed (e.g. a DOMException with a numeric code)", async () => {
    // Regression: duck-typing on `"code" in err` once let this through
    // to res.status(undefined), which threw inside an async handler.
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

// Route-level behaviour with a STUBBED QuoteProvider — no vendor,
// no sockets, fully deterministic. This is what the QuoteProvider
// interface exists for.

import { describe, it, expect, afterEach, vi } from "vitest";
import type { QuoteRequest, QuoteResponse } from "@commission-quote/contract";
import { createApp } from "../app";
import { startApp, loanPayload } from "./test-server";

let harness: Awaited<ReturnType<typeof startApp>> | undefined;

afterEach(async () => {
  await harness?.close();
  vi.restoreAllMocks();
});

const QUOTE: QuoteResponse = {
  quoteId: "11111111-1111-4111-8111-111111111111",
  commissionRate: 0.035,
  totalCommission: 8750,
};

function stubProvider(
  impl: (req: QuoteRequest) => Promise<QuoteResponse>
) {
  return { generateQuote: vi.fn(impl) };
}

async function post(body: string) {
  return fetch(`${harness!.url}/api/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
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

    await post(loanPayload());
    const arg = provider.generateQuote.mock.calls[0][0] as QuoteRequest;
    expect(arg).toEqual({ loanAmount: 250000, loanTermInMonths: 36, riskBand: "MEDIUM" });
  });

  it.each([
    { field: "loanAmount", value: -100, expected: 400 },
    { field: "riskBand", value: "EXTREME", expected: 400 },
    { field: "loanTermInMonths", value: 12.5, expected: 400 }, // non-integer
  ])("returns 400 VALIDATION_ERROR for bad $field", async ({ field, value, expected }) => {
    const provider = stubProvider(async () => QUOTE);
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post(loanPayload({ [field]: value }));
    expect(res.status).toBe(expected);

    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    // Message must be user-displayable, not a Zod dump.
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);

    // Validation happens BEFORE the vendor is touched — no wasted call.
    expect(provider.generateQuote).not.toHaveBeenCalled();
  });

  it.each([
    { code: "VENDOR_TIMEOUT", expectedStatus: 504 },
    { code: "SERVICE_UNAVAILABLE", expectedStatus: 503 },
    { code: "VENDOR_ERROR", expectedStatus: 502 },
  ] as const)("maps $code to $expectedStatus", async ({ code, expectedStatus }) => {
    const provider = stubProvider(() =>
      Promise.reject({ code, message: "vendor blew up" })
    );
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post(loanPayload());
    expect(res.status).toBe(expectedStatus);

    const body = await res.json();
    expect(body.code).toBe(code);
    expect(body.message).toBe("vendor blew up");
  });

  it("returns 500 with a safe message when the provider throws something untyped", async () => {
    // Silence the route's deliberate alarm for THIS test — we assert
    // it fired, so the console noise is proven rather than merely
    // tolerated (and doesn't pollute every future test run).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { });

    const provider = stubProvider(() => Promise.reject(new Error("secret stack details")));
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post(loanPayload());
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("secret stack details");

    // The alarm rang — loudly, with the real details — on the server side.
    expect(errorSpy).toHaveBeenCalledWith("[quote-service] unexpected failure:", expect.any(Error));
  });

  it("returns 400 VALIDATION_ERROR for a malformed JSON body", async () => {
    const provider = stubProvider(async () => QUOTE);
    harness = await startApp(createApp({ quoteService: provider }));

    const res = await post("{not json");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});
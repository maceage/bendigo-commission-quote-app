// The whole backend path over real HTTP: quote-service's app, QuoteService
// and VendorQuoteClient calling the real mock vendor. Every other suite
// tests one side against a stand-in, so only this one catches the two
// sides drifting apart (header name, path, payload shape).

import { describe, it, expect, afterEach } from "vitest";
import { QuoteErrorSchema, QuoteResponseSchema, REQUEST_ID_HEADER } from "@commission-quote/contract";
import { createApp as createVendorApp, type VendorApiOptions } from "@commission-quote/vendor-api/app";
import { createApp } from "../src/app";
import { QuoteService } from "../src/services/quote.service";
import { VendorQuoteClient, type VendorClientConfig } from "../src/services/vendor-client";
import { startApp, loanPayload, captureLogs } from "./test-server";

const KEY = "test-vendor-key-123";

let harnesses: Awaited<ReturnType<typeof startApp>>[] = [];

afterEach(async () => {
  await Promise.all(harnesses.map((h) => h.close()));
  harnesses = [];
});

/** Starts the mock vendor and quote-service wired to it; returns a POST /api/quotes helper. */
async function startStack(vendor: Partial<VendorApiOptions> = {}, clientConfig: Partial<VendorClientConfig> = {}) {
  const vendorHarness = await startApp(
    createVendorApp({ apiKey: KEY, failureRate: 0, timeoutRate: 0, latencyMs: [0, 0], ...vendor }),
  );
  harnesses.push(vendorHarness);

  const client = new VendorQuoteClient({ baseUrl: vendorHarness.url, apiKey: KEY, baseDelayMs: 10, ...clientConfig });
  const service = await startApp(createApp({ quoteService: new QuoteService(client) }));
  harnesses.push(service);

  return (body: string) =>
    fetch(`${service.url}/api/quotes`, { method: "POST", headers: { "content-type": "application/json" }, body });
}

describe("quote-service -> mock vendor", () => {
  it("logs the request under one request ID in both services", async () => {
    const { logger: vendorLogger, lines: vendorLines } = captureLogs();
    const post = await startStack({ logger: vendorLogger });
    const res = await post(loanPayload());

    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toBeTruthy();
    expect(vendorLines).toContainEqual(expect.objectContaining({ req: expect.objectContaining({ id }) }));
  });

  it("returns the vendor's quote for valid loan details", async () => {
    const post = await startStack();
    const res = await post(loanPayload());

    expect(res.status).toBe(200);
    const quote = QuoteResponseSchema.parse(await res.json());
    expect(quote.commissionRate).toBe(0.035);
    expect(quote.totalCommission).toBe(8750);
  });

  it("surfaces a key the vendor rejects as VENDOR_ERROR without retrying", async () => {
    const post = await startStack({}, { apiKey: "not-the-key" });
    const res = await post(loanPayload());

    expect(res.status).toBe(502);
    expect(QuoteErrorSchema.parse(await res.json()).code).toBe("VENDOR_ERROR");
  });

  it("returns SERVICE_UNAVAILABLE once every retry hits the vendor's simulated failure", async () => {
    const post = await startStack({ failureRate: 1 });
    const res = await post(loanPayload());

    expect(res.status).toBe(503);
    expect(QuoteErrorSchema.parse(await res.json()).code).toBe("SERVICE_UNAVAILABLE");
  });

  it("recovers from a timed-out attempt with the quote it issued, not a duplicate", async () => {
    // The vendor rolls for failure then for a hang on a new quote, and only
    // for a hang when replaying an Idempotency-Key. With failureRate 0 and
    // timeoutRate 0.5 this script means: attempt 1 issues a quote but never
    // answers; attempt 2 (same key) gets that quote back.
    const rolls = [0.9, 0.1, 0.9];
    const random = () => {
      const next = rolls.shift();
      if (next === undefined) throw new Error("vendor rolled more often than the test scripted");
      return next;
    };
    const { logger: vendorLogger, lines: vendorLines } = captureLogs();
    const post = await startStack(
      { timeoutRate: 0.5, random, logger: vendorLogger },
      { timeoutMs: 200, totalTimeoutMs: 2_000 },
    );

    const res = await post(loanPayload());
    expect(res.status).toBe(200);
    const quote = QuoteResponseSchema.parse(await res.json());

    const hung = vendorLines.filter((l) => l.msg === "simulated timeout: not responding");
    expect(hung).toHaveLength(1);
    expect(quote.quoteId).toBe(hung[0]!.quoteId);
    expect(rolls).toHaveLength(0); // exactly two attempts reached the vendor
  });

  it("returns VENDOR_TIMEOUT when the vendor never responds", async () => {
    const post = await startStack({ timeoutRate: 1 }, { timeoutMs: 100, totalTimeoutMs: 500 });
    const res = await post(loanPayload());

    expect(res.status).toBe(504);
    expect(QuoteErrorSchema.parse(await res.json()).code).toBe("VENDOR_TIMEOUT");
  });
});

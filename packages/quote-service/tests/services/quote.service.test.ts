// Deliberately minimal: QuoteService is currently a delegation
// seam. This pins its CONTRACT (same request in, same result out,
// errors propagate untouched) so future extensions (caching,
// auditing) have a starting point to modify.

import { describe, it, expect, vi } from "vitest";
import { pino } from "pino";
import type { QuoteRequest, QuoteResponse } from "@commission-quote/contract";
import { QuoteService } from "../../src/services/quote.service";
import { VendorClientError } from "../../src/services/vendor-client";

const REQUEST: QuoteRequest = {
  loanAmount: "250000",
  loanTermInMonths: 36,
  riskBand: "MEDIUM",
};

const QUOTE: QuoteResponse = {
  quoteId: "33333333-3333-4333-8333-333333333333",
  commissionRate: 0.035,
  totalCommission: "8750.00",
};

describe("QuoteService", () => {
  it("delegates to the vendor client, passing the request context through", async () => {
    const vendorClient = { generateQuote: vi.fn().mockResolvedValue(QUOTE) };
    const service = new QuoteService(vendorClient);
    const context = { requestId: "req-1", log: pino({ level: "silent" }) };

    const result = await service.generateQuote(REQUEST, context);

    expect(result).toEqual(QUOTE);
    expect(vendorClient.generateQuote).toHaveBeenCalledWith(REQUEST, context);
  });

  it("propagates vendor failures unchanged — no swallowing here", async () => {
    const failure = new VendorClientError("VENDOR_TIMEOUT", "Vendor timed out.");
    const vendorClient = { generateQuote: vi.fn().mockRejectedValue(failure) };
    const service = new QuoteService(vendorClient);

    await expect(service.generateQuote(REQUEST)).rejects.toBe(failure);
  });
});

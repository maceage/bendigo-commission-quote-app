// Deliberately minimal: QuoteService is currently a delegation
// seam. This pins its CONTRACT (same request in, same result out,
// errors propagate untouched) so future extensions (caching,
// idempotency keys, auditing) have a starting point to modify.

import { describe, it, expect, vi } from "vitest";
import type { QuoteRequest, QuoteResponse } from "@commission-quote/contract";
import { QuoteService } from "../services/quote.service";

const REQUEST: QuoteRequest = {
  loanAmount: 250_000,
  loanTermInMonths: 36,
  riskBand: "MEDIUM",
};

const QUOTE: QuoteResponse = {
  quoteId: "33333333-3333-4333-8333-333333333333",
  commissionRate: 0.035,
  totalCommission: 8750,
};

describe("QuoteService", () => {
  it("delegates to the vendor client and returns its quote", async () => {
    const vendorClient = { generateQuote: vi.fn().mockResolvedValue(QUOTE) };
    const service = new QuoteService(vendorClient as never);

    const result = await service.generateQuote(REQUEST);

    expect(result).toEqual(QUOTE);
    expect(vendorClient.generateQuote).toHaveBeenCalledWith(REQUEST);
  });

  it("propagates vendor failures unchanged — no swallowing here", async () => {
    const failure = { code: "VENDOR_TIMEOUT", message: "Vendor timed out." };
    const vendorClient = { generateQuote: vi.fn().mockRejectedValue(failure) };
    const service = new QuoteService(vendorClient as never);

    await expect(service.generateQuote(REQUEST)).rejects.toEqual(failure);
  });
});
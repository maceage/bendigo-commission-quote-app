// Orchestration: route -> [validate] -> here -> vendor client -> route.
// Contains NO commission math — the vendor owns that. This layer exists
// so the route stays a thin translator and the vendor client stays a
// pure HTTP seam; anything that's "policy" about the interaction lives
// here (today: minimal; but this is where rate limiting, caching of
// identical quote requests, auditing, or idempotency keys would go
// when the app grows).

import type { QuoteRequest, QuoteResponse } from "@commission-quote/contract";
import type { VendorQuoteClient } from "./vendor-client";

export class QuoteService {
  constructor(private readonly vendorClient: VendorQuoteClient) {}

  async generateQuote(request: QuoteRequest): Promise<QuoteResponse> {
    // Input has ALREADY been validated by the route — re-validating
    // here would duplicate work; trusting it here is fine because the
    // boundary (route) enforces it.
    return this.vendorClient.generateQuote(request);
  }
}
// Orchestration: route -> [validate] -> here -> vendor client -> route.
// Contains NO commission math — the vendor owns that. This layer keeps
// the route a thin translator and the vendor client a pure HTTP seam;
// policy about the interaction (rate limiting, caching identical
// requests, auditing) belongs here as the app grows.

import type { QuoteRequest, QuoteResponse } from "@commission-quote/contract";
import type { QuoteProvider } from "./quote-provider";

export class QuoteService implements QuoteProvider {
  constructor(private readonly vendorClient: QuoteProvider) {}

  async generateQuote(request: QuoteRequest): Promise<QuoteResponse> {
    // Input has already been validated at the route boundary.
    return this.vendorClient.generateQuote(request);
  }
}

import type { QuoteRequest, QuoteResponse } from "@commission-quote/contract";

// The route layer depends on the SHAPE of a quote source, not a
// concrete class — anything quote-shaped can be injected (test double).
export interface QuoteProvider {
  generateQuote(request: QuoteRequest): Promise<QuoteResponse>;
}

import type { QuoteRequest, QuoteResponse } from "@commission-quote/contract";
import type { Logger } from "../logger";

/** Per-request context, so one request can be traced through the logs and to the vendor. */
export interface QuoteContext {
  requestId: string;
  log: Logger;
}

// The route layer depends on the SHAPE of a quote source, not a
// concrete class — anything quote-shaped can be injected (test double).
export interface QuoteProvider {
  generateQuote(request: QuoteRequest, context?: QuoteContext): Promise<QuoteResponse>;
}

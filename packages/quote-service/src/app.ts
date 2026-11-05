// Builds the Express app without listening — importable by tests.

import express from "express";
import { quoteRoutes } from "./routes/quote.routes";
import { errorHandler } from "./middleware/error-handler";

// The route layer depends on the SHAPE of the vendor client, not the
// class itself — anything quote-shaped can be injected (test double).
export interface QuoteProvider {
  generateQuote(request: import("@commission-quote/contract").QuoteRequest): Promise<
    import("@commission-quote/contract").QuoteResponse
  >;
}

export function createApp({ quoteService }: { quoteService: QuoteProvider }) {
  const app = express();
  app.use(express.json());
  app.use("/api", quoteRoutes(quoteService));
  app.use(errorHandler);
  return app;
}
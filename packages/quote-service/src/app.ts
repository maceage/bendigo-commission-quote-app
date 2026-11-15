// Builds the Express app without listening — importable by tests.

import express from "express";
import { quoteRoutes } from "./routes/quote.routes";
import { errorHandler } from "./middleware/error-handler";
import type { QuoteProvider } from "./services/quote-provider";

export type { QuoteProvider };

export function createApp({ quoteService }: { quoteService: QuoteProvider }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api", quoteRoutes(quoteService));
  app.use(errorHandler);
  return app;
}

// Builds the Express app without listening — importable by tests.

import express from "express";
import { pinoHttp } from "pino-http";
import { quoteRoutes } from "./routes/quote.routes";
import { errorHandler } from "./middleware/error-handler";
import { createLogger, logLevelFor, requestId, type Logger } from "./logger";
import type { QuoteProvider } from "./services/quote-provider";

export type { QuoteProvider };

export function createApp({ quoteService, logger = createLogger() }: { quoteService: QuoteProvider; logger?: Logger }) {
  const app = express();
  app.disable("x-powered-by");
  // First, so every later middleware (including body parsing errors)
  // has req.id and req.log.
  app.use(
    pinoHttp({
      logger,
      genReqId: requestId,
      customLogLevel: logLevelFor,
      // req.log lines carry just the request ID; the full request is on
      // the one completion line pino-http writes per request.
      quietReqLogger: true,
      autoLogging: { ignore: (req) => req.url === "/healthz" },
    }),
  );
  app.use(express.json({ limit: "10kb" }));
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api", quoteRoutes(quoteService));
  app.use(errorHandler);
  return app;
}

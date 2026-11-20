// Builds the Express app WITHOUT starting a listener. Both the real
// server (server.ts) and tests import this, so tests can hit the app
// in-process with no port juggling.

import express, { type Request, type Response, type NextFunction } from "express";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { QuoteRequestSchema } from "@commission-quote/contract";
import { createLogger, logLevelFor, requestId, type Logger } from "./logger";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { IdempotencyStore, fingerprint } from "./services/idempotency-store";
import { generateQuote } from "./services/quote-engine";

export interface VendorApiOptions {
  apiKey: string;
  /** Probability (0-1) that any given quote request randomly fails. */
  failureRate?: number;
  /** Probability (0-1) that a quote is issued but the response never arrives. */
  timeoutRate?: number;
  /** Simulated latency range in ms: [min, max]. */
  latencyMs?: [number, number];
  /**
   * Source of the rolls that decide simulated failures and hangs
   * (0 <= n < 1). Tests inject a script to get an exact sequence of
   * outcomes, e.g. "hang, then respond".
   */
  random?: () => number;
  /** How many idempotency keys the mock remembers (oldest evicted first). */
  idempotencyCacheSize?: number;
  /** File that keeps issued quotes across restarts; in memory only if absent. */
  idempotencyFile?: string;
  /** How long an idempotency key lasts, in ms (default 24 hours); after that it's new. */
  idempotencyTtlMs?: number;
  logger?: Logger;
}

const DEFAULTS = {
  // 20% of requests fail: often enough to demonstrate retries, rare
  // enough that the demo isn't painful.
  failureRate: 0.2,
  // 5% hang: rare, because each one costs the caller a full timeout.
  timeoutRate: 0.05,
  latencyMs: [50, 400] as [number, number],
  random: Math.random,
  idempotencyCacheSize: 1_000,
  // A day: long enough for any retry, as with real vendors' keys.
  idempotencyTtlMs: 24 * 60 * 60 * 1000,
};

export function createApp(options: VendorApiOptions) {
  const cfg = { ...DEFAULTS, ...options };
  const app = express();
  app.disable("x-powered-by");
  app.use(
    pinoHttp({
      logger: options.logger ?? createLogger(),
      genReqId: requestId,
      customLogLevel: logLevelFor,
      quietReqLogger: true,
      autoLogging: { ignore: (req) => req.url === "/healthz" },
    }),
  );

  // Quotes already issued, by Idempotency-Key.
  const issued = new IdempotencyStore({
    capacity: cfg.idempotencyCacheSize,
    ttlMs: cfg.idempotencyTtlMs,
    file: cfg.idempotencyFile,
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  // THE security requirement: every route added after this middleware
  // is unreachable without a valid API key.
  app.use(apiKeyAuth(cfg.apiKey));

  app.use(express.json({ limit: "10kb" }));

  // The agreed contract endpoint.
  app.post("/quotes", (req: Request, res: Response, next: NextFunction) => {
    simulateLatency(cfg.latencyMs, () => {
      try {
        // Validated first, so a replay is matched on what it asks for.
        const request = QuoteRequestSchema.parse(req.body);
        const requestFingerprint = fingerprint(request);
        const key = req.header("idempotency-key");
        const previous = key === undefined ? undefined : issued.get(key);

        // A key names one request: reusing it for a different loan is the
        // caller's bug, and answering with the first loan's quote would hide it.
        if (previous !== undefined && previous.fingerprint !== requestFingerprint) {
          req.log.warn("idempotency key reused for a different request");
          res.status(422).json({ error: "Idempotency-Key was already used for a different request." });
          return;
        }

        let quote = previous?.quote;
        if (quote === undefined) {
          if (cfg.random() < cfg.failureRate) {
            req.log.warn("simulated failure");
            res.status(500).json({ error: "Internal vendor error." });
            return;
          }

          quote = generateQuote(request);
          if (key !== undefined) issued.set(key, { fingerprint: requestFingerprint, quote });
        }

        // The quote exists, but the caller never hears back: like a
        // response lost in transit. The connection stays open until the
        // caller gives up, and a retry with the same Idempotency-Key gets
        // this quote rather than a duplicate.
        if (cfg.random() < cfg.timeoutRate) {
          req.log.warn({ quoteId: quote.quoteId }, "simulated timeout: not responding");
          return;
        }

        res.status(200).json(quote);
      } catch (err) {
        // Forwarded by hand: Express 5 only catches errors thrown by the
        // handler itself or its returned promise, not by a later callback.
        next(err);
      }
    });
  });

  // Uniform, opaque error envelope — nothing about our stack leaks.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: unknown } | null)?.status;
    if (err instanceof ZodError || (err instanceof SyntaxError && status === 400)) {
      res.status(400).json({ error: "Invalid request payload." });
      return;
    }
    if (status === 413) {
      res.status(413).json({ error: "Request payload too large." });
      return;
    }
    req.log.error({ err }, "unexpected failure");
    res.status(500).json({ error: "Internal vendor error." });
  });

  return app;
}

function simulateLatency([min, max]: [number, number], fn: () => void) {
  const delay = min + Math.random() * (max - min);
  setTimeout(fn, delay);
}

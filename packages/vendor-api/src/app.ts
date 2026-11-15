// Builds the Express app WITHOUT starting a listener. Both the real
// server (server.ts) and tests import this, so tests can hit the app
// in-process with no port juggling.

import express, { type Request, type Response, type NextFunction } from "express";
import { ZodError } from "zod";
import type { QuoteResponse } from "@commission-quote/contract";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { generateQuote } from "./services/quote-engine";

export interface VendorApiOptions {
  apiKey: string;
  /** Probability (0-1) that any given quote request randomly fails. */
  failureRate?: number;
  /** Simulated latency range in ms: [min, max]. */
  latencyMs?: [number, number];
}

const DEFAULTS = {
  // 20% of requests fail: often enough to demonstrate retries, rare
  // enough that the demo isn't painful.
  failureRate: 0.2,
  latencyMs: [50, 400] as [number, number],
};

/** How many idempotency keys the mock remembers (oldest evicted first). */
const IDEMPOTENCY_CACHE_SIZE = 1_000;

export function createApp(options: VendorApiOptions) {
  const cfg = { ...DEFAULTS, ...options };
  const app = express();
  app.disable("x-powered-by");

  // Quotes already issued, by Idempotency-Key: a retried request gets
  // the original quote back instead of a new one. Map preserves
  // insertion order, which gives us cheap FIFO eviction.
  const issued = new Map<string, QuoteResponse>();

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
        const key = req.header("idempotency-key");
        const previous = key === undefined ? undefined : issued.get(key);
        if (previous !== undefined) {
          res.status(200).json(previous);
          return;
        }

        if (Math.random() < cfg.failureRate) {
          res.status(500).json({ error: "Internal vendor error." });
          return;
        }

        const quote = generateQuote(req.body);
        if (key !== undefined) {
          issued.set(key, quote);
          if (issued.size > IDEMPOTENCY_CACHE_SIZE) {
            issued.delete(issued.keys().next().value!);
          }
        }
        res.status(200).json(quote);
      } catch (err) {
        next(err);
      }
    });
  });

  // Uniform, opaque error envelope — nothing about our stack leaks.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: unknown } | null)?.status;
    if (err instanceof ZodError || (err instanceof SyntaxError && status === 400)) {
      res.status(400).json({ error: "Invalid request payload." });
      return;
    }
    if (status === 413) {
      res.status(413).json({ error: "Request payload too large." });
      return;
    }
    console.error("[vendor-api]", err);
    res.status(500).json({ error: "Internal vendor error." });
  });

  return app;
}

function simulateLatency([min, max]: [number, number], fn: () => void) {
  const delay = min + Math.random() * (max - min);
  setTimeout(fn, delay);
}

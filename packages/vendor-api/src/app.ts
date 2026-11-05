// ===== packages/vendor-api/src/app.ts =====
//
// Builds the Express app WITHOUT starting a listener. Both the real
// server (server.ts) and tests import this, so tests can hit the app
// in-process with no port juggling.

import express, { type Request, type Response, type NextFunction } from "express";
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
    failureRate: 0.2,          // 20% of requests blow up — often enough to
    // demonstrate retries, not so often that the
    // demo experience is painful
    latencyMs: [50, 400] as [number, number],
};

export function createApp(options: VendorApiOptions) {
    const cfg = { ...DEFAULTS, ...options };
    const app = express();

    app.use(express.json());

    // THE security requirement: every route added after this middleware
    // is unreachable without a valid API key.
    app.use(apiKeyAuth(cfg.apiKey));

    // The agreed contract endpoint.
    app.post("/quotes", (req: Request, res: Response) => {
        simulateLatency(cfg.latencyMs!, () => {
            try {
                if (Math.random() < cfg.failureRate) {
                    res.status(500).json({ error: "Internal vendor error." });
                    return;
                }
                res.status(200).json(generateQuote(req.body));
            } catch (err) {
                // ZodError = invalid payload, vendor-style 400; anything else
                // is treated as the simulated 500 — opaque either way.
                if (err instanceof Error && err.name === "ZodError") {
                    res.status(400).json({ error: "Invalid request payload." });
                    return;
                }
                res.status(500).json({ error: "Internal vendor error." });
            }
        });
    });

    // Uniform error envelope — nothing about our stack leaks upward.
    // Includes turning ZodError (bad payload shape) into a vendor-style 400.
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        if (err.name === "ZodError") {
            res.status(400).json({ error: "Invalid request payload." });
            return;
        }
        console.error("[vendor-api]", err.message);
        res.status(500).json({ error: "Internal vendor error." });
    });

    return app;
}

function simulateLatency([min, max]: [number, number], fn: () => void) {
    const delay = min + Math.random() * (max - min);
    setTimeout(fn, delay);
}
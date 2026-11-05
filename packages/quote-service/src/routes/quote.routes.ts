// One route. Thin by design: validate, delegate, translate failures.
// No business logic lives here on purpose.

import { Router, type Request, type Response } from "express";
import { QuoteRequestSchema, type QuoteError, type QuoteErrorCode } from "@commission-quote/contract";
import type { QuoteProvider } from "../app";
import type { VendorClientError } from "../services/vendor-client";

// Maps the vendor client's typed failure to the contract's error
// envelope with the HTTP status the UI expects.
function statusFor(code: QuoteErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "VENDOR_TIMEOUT":
      return 504;
    case "SERVICE_UNAVAILABLE":
      return 503;
    case "VENDOR_ERROR":
      return 502;
  }
}

export function quoteRoutes(quoteService: QuoteProvider): Router {
  const router = Router();

  router.post("/quotes", async (req: Request, res: Response) => {
    // Validate at OUR boundary — never trust client input, and don't
    // waste a round-trip to the vendor on garbage.
    const parsed = QuoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const error: QuoteError = {
        code: "VALIDATION_ERROR",
        // Zod's first issue message is precise AND user-safe — e.g.
        // "loanAmount must be greater than zero". Shows we surface
        // useful feedback rather than a vague "invalid input".
        message: parsed.error.issues[0]?.message ?? "Invalid loan details.",
      };
      res.status(statusFor(error.code)).json(error);
      return;
    }

    try {
      const quote = await quoteService.generateQuote(parsed.data);
      res.status(200).json(quote);
    } catch (err) {
      const failure = err as VendorClientError;
      // Defensive: anything that reaches here without our typed shape
      // is OUR bug — log loudly, give the user nothing sensitive.
      if (!("code" in (failure ?? {})) || !("message" in failure)) {
        console.error("[quote-service] unexpected failure:", err);
        res.status(500).json({ code: "VENDOR_ERROR", message: "Something went wrong." } satisfies QuoteError);
        return;
      }
      res.status(statusFor(failure.code)).json({ code: failure.code, message: failure.message });
    }
  });

  return router;
}
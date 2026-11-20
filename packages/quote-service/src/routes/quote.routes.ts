// One route. Thin by design: validate, delegate, translate failures.
// No business logic lives here on purpose.

import { Router, type Request, type Response } from "express";
import { QUOTE_ERROR_STATUS, QuoteRequestSchema, type QuoteError } from "@commission-quote/contract";
import type { QuoteProvider } from "../services/quote-provider";
import { VendorClientError } from "../services/vendor-client";

function sendError(res: Response, error: QuoteError): void {
  res.status(QUOTE_ERROR_STATUS[error.code]).json(error);
}

export function quoteRoutes(quoteService: QuoteProvider): Router {
  const router = Router();

  router.post("/quotes", async (req: Request, res: Response) => {
    // Validate at OUR boundary — never trust client input, and don't
    // waste a round-trip to the vendor on garbage.
    const parsed = QuoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // The contract's messages are written to be shown to users.
      sendError(res, {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid loan details.",
      });
      return;
    }

    try {
      const quote = await quoteService.generateQuote(parsed.data);
      res.status(200).json(quote);
    } catch (err) {
      if (err instanceof VendorClientError) {
        sendError(res, { code: err.code, message: err.message });
        return;
      }
      // Anything else is OUR bug. Express 5 passes the rejection to the
      // error handler, which logs it and gives the user nothing sensitive.
      throw err;
    }
  });

  return router;
}

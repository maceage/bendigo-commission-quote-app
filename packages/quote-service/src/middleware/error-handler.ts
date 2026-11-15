// Last-resort error middleware: malformed JSON bodies, oversized
// bodies, and anything a route didn't expect.

import type { Request, Response, NextFunction } from "express";
import type { QuoteError } from "@commission-quote/contract";

function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = httpStatusOf(err);

  // express.json() rejects malformed JSON with a SyntaxError carrying
  // status 400 — honour it so the UI can render a helpful message.
  if (err instanceof SyntaxError && status === 400) {
    res
      .status(400)
      .json({ code: "VALIDATION_ERROR", message: "Request body was not valid JSON." } satisfies QuoteError);
    return;
  }
  if (status === 413) {
    res.status(413).json({ code: "VALIDATION_ERROR", message: "Request body is too large." } satisfies QuoteError);
    return;
  }

  console.error("[quote-service] unexpected failure:", err);
  res.status(500).json({ code: "INTERNAL_ERROR", message: "Something went wrong." } satisfies QuoteError);
}

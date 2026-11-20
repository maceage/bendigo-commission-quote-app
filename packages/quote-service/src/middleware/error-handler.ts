// Last-resort error middleware: malformed JSON bodies, oversized
// bodies, and anything a route didn't expect.

import type { Request, Response, NextFunction } from "express";
import { sendError } from "../send-error";

function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = httpStatusOf(err);

  // express.json() rejects malformed JSON with a SyntaxError carrying
  // status 400 — honour it so the UI can render a helpful message.
  if (err instanceof SyntaxError && status === 400) {
    sendError(req, res, { code: "VALIDATION_ERROR", message: "Request body was not valid JSON." });
    return;
  }
  if (status === 413) {
    sendError(req, res, { code: "VALIDATION_ERROR", message: "Request body is too large." }, 413);
    return;
  }

  // Full details go to the log (with the request ID); the user gets a
  // generic message and the same ID to quote.
  req.log.error({ err }, "unexpected failure");
  sendError(req, res, { code: "INTERNAL_ERROR", message: "Something went wrong." });
}

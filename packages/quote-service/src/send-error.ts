// The one way quote-service sends an error envelope: the contract's
// status for the code, plus the request ID so a user can quote it to
// support and it can be found in the logs.

import type { Request, Response } from "express";
import { QUOTE_ERROR_STATUS, type QuoteError } from "@commission-quote/contract";

export function sendError(
  req: Request,
  res: Response,
  error: Omit<QuoteError, "requestId">,
  status = QUOTE_ERROR_STATUS[error.code],
): void {
  res.status(status).json({ ...error, requestId: String(req.id) } satisfies QuoteError);
}

// Last-resort error middleware (malformed JSON bodies, etc.).

import type { Request, Response, NextFunction } from "express";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // express.json() rejects malformed JSON with a SyntaxError carrying
  // status 400 — honour it so the UI can render a helpful message.
  if (err.name === "SyntaxError" && "status" in err && (err as { status?: number }).status === 400) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Request body was not valid JSON." });
    return;
  }
  console.error("[quote-service] unhandled error:", err.message);
  res.status(500).json({ code: "VENDOR_ERROR", message: "Something went wrong." });
}

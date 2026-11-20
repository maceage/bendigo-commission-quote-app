// Strictly secured, per the contract: no valid key, no service.

import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { API_KEY_HEADER } from "@commission-quote/contract";

export function apiKeyAuth(expectedKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.header(API_KEY_HEADER);

    // Compare in constant time to avoid leaking key length/content
    // via timing differences. Buffers must be equal length to compare.
    const valid =
      typeof provided === "string" &&
      provided.length === expectedKey.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expectedKey));

    if (!valid) {
      // Same response for "missing" and "wrong" key — don't tell
      // attackers which they got closer to.
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    next();
  };
}

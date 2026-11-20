// Strictly secured, per the contract: no valid key, no service.

import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { API_KEY_HEADER } from "@commission-quote/contract";

function digest(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

export function apiKeyAuth(expectedKey: string) {
  const expected = digest(expectedKey);

  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.header(API_KEY_HEADER);

    // Compare in constant time to avoid leaking the key via timing
    // differences. timingSafeEqual needs buffers of equal length, so
    // compare SHA-256 digests (always 32 bytes): any key, whatever its
    // length or characters, is compared without throwing or revealing
    // the real key's length.
    const valid = typeof provided === "string" && timingSafeEqual(digest(provided), expected);

    if (!valid) {
      // Same response for "missing" and "wrong" key — don't tell
      // attackers which they got closer to.
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    next();
  };
}

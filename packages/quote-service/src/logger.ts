// Structured JSON logging (pino) and request IDs. Same helpers as
// vendor-api's logger.ts, duplicated per package like test-server.ts.

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pino, type DestinationStream, type Logger } from "pino";
import { REQUEST_ID_HEADER } from "@commission-quote/contract";

export type { Logger };

/** `level` and `destination` let tests capture output with the real config. */
export function createLogger({ level, destination }: { level?: string; destination?: DestinationStream } = {}): Logger {
  return pino(
    {
      name: "quote-service",
      // Silent under Vitest so test output stays readable; LOG_LEVEL overrides.
      level: level ?? (process.env.LOG_LEVEL || undefined) ?? (process.env.VITEST ? "silent" : "info"),
    },
    destination ?? pino.destination(1),
  );
}

// Accept only short, plain IDs from callers, so a crafted header can't
// inject junk into the logs or the error shown to the user.
const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;

/** Reuses a well-formed incoming request ID, else makes one, and echoes it on the response. */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/** 5xx and thrown errors log as error, 4xx as warn, everything else as info. */
export function logLevelFor(_req: IncomingMessage, res: ServerResponse, err?: Error): "error" | "warn" | "info" {
  if (err || res.statusCode >= 500) return "error";
  return res.statusCode >= 400 ? "warn" : "info";
}

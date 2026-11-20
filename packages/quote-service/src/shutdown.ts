// Graceful shutdown with a time limit. Same helper as vendor-api's
// shutdown.ts, duplicated per package like logger.ts. server.ts calls it
// on SIGTERM (docker compose stop) and SIGINT (Ctrl-C).

import type { Server } from "node:http";
import type { Logger } from "./logger";

/** How often to close connections that have finished their request. */
const IDLE_SWEEP_MS = 50;

/**
 * Stops accepting connections, lets requests in progress finish, and
 * cuts off whatever is still running after `timeoutMs`. Resolves once
 * the server has closed; `forced` says whether anything was cut off.
 */
export function closeGracefully(
  server: Server,
  { timeoutMs, logger }: { timeoutMs: number; logger: Logger },
): Promise<{ forced: boolean }> {
  return new Promise((resolve) => {
    let forced = false;

    // close() only closes connections that are idle at that moment; a
    // keep-alive connection whose request finishes later would otherwise
    // hold the server open until its keep-alive timeout.
    const sweep = setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_MS);
    const limit = setTimeout(() => {
      forced = true;
      logger.warn({ timeoutMs }, "requests still running at the shutdown time limit; cutting them off");
      server.closeAllConnections();
    }, timeoutMs);

    server.close(() => {
      clearInterval(sweep);
      clearTimeout(limit);
      resolve({ forced });
    });
  });
}

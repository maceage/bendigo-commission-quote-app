// Thin launcher: reads env, creates the app, listens.

import { createApp } from "./app";
import { ConfigError, loadConfig, type VendorConfig } from "./config";
import { createLogger } from "./logger";
import { closeGracefully } from "./shutdown";

const logger = createLogger();

let config: VendorConfig;
try {
  config = loadConfig();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  logger.fatal(err.message);
  process.exit(1);
}

const { port, ...appOptions } = config;
let app: ReturnType<typeof createApp>;
try {
  app = createApp({ ...appOptions, logger });
} catch (err) {
  // E.g. an idempotency file it can't trust: one fatal log line, not a raw stack trace.
  logger.fatal({ err }, "couldn't start");
  process.exit(1);
}

const server = app.listen(port, () => {
  logger.info({ port }, "mock Commission Quote API listening");
});

// Enough for any request still in its simulated latency (at most 400ms);
// a simulated hang never finishes, so waiting longer gains nothing.
const SHUTDOWN_TIMEOUT_MS = 1_000;

// docker compose stop sends SIGTERM, Ctrl-C SIGINT. A second signal
// while shutting down stops at once.
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    logger.info({ signal }, "shutting down");
    void closeGracefully(server, { timeoutMs: SHUTDOWN_TIMEOUT_MS, logger }).then(({ forced }) => {
      logger.info({ forced }, "shut down");
      process.exit(0);
    });
  });
}

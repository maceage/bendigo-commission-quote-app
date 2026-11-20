// Thin launcher: reads env, creates the app, listens.

import { createApp } from "./app";
import { ConfigError, loadConfig, type VendorConfig } from "./config";
import { createLogger } from "./logger";

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
createApp({ ...appOptions, logger }).listen(port, () => {
  logger.info({ port }, "mock Commission Quote API listening");
});

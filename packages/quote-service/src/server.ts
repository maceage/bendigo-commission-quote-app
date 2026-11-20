// Thin launcher: reads env, wires dependencies, listens. All real
// logic lives elsewhere so tests never need to spawn a server.

import { createApp } from "./app";
import { ConfigError, loadConfig, type QuoteServiceConfig } from "./config";
import { createLogger } from "./logger";
import { QuoteService } from "./services/quote.service";
import { VendorQuoteClient } from "./services/vendor-client";

const logger = createLogger();

let config: QuoteServiceConfig;
try {
  config = loadConfig();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  logger.fatal(err.message);
  process.exit(1);
}

// The ONLY place the vendor API key exists in this app: constructed
// once here, held privately inside the client. Routes receive the
// service via dependency injection and never see the key.
const vendorClient = new VendorQuoteClient({
  baseUrl: config.vendorBaseUrl,
  apiKey: config.apiKey,
});
const quoteService = new QuoteService(vendorClient);

createApp({ quoteService, logger }).listen(config.port, () => {
  logger.info({ port: config.port, vendorBaseUrl: config.vendorBaseUrl }, "quote-service listening");
});

// Thin launcher: reads env, wires dependencies, listens. All real
// logic lives elsewhere so tests never need to spawn a server.

import { createApp } from "./app";
import { createLogger } from "./logger";
import { QuoteService } from "./services/quote.service";
import { VendorQuoteClient } from "./services/vendor-client";

const logger = createLogger();

const PORT = Number(process.env.PORT || 4000);

const API_KEY = process.env.VENDOR_API_KEY;
const VENDOR_BASE_URL = process.env.VENDOR_API_BASE_URL || "http://localhost:4001";

if (!API_KEY) {
  logger.fatal(
    "VENDOR_API_KEY must be set — the vendor API key must never be defaulted or hardcoded (see .env.example)",
  );
  process.exit(1);
}

// The ONLY place the vendor API key exists in this app: constructed
// once here, held privately inside the client. Routes receive the
// service via dependency injection and never see the key.
const vendorClient = new VendorQuoteClient({
  baseUrl: VENDOR_BASE_URL,
  apiKey: API_KEY,
});
const quoteService = new QuoteService(vendorClient);

createApp({ quoteService, logger }).listen(PORT, () => {
  logger.info({ port: PORT, vendorBaseUrl: VENDOR_BASE_URL }, "quote-service listening");
});

// Thin launcher: reads env, wires dependencies, listens. All real
// logic lives elsewhere so tests never need to spawn a server.

import { createApp } from "./app";
import { VendorQuoteClient } from "./services/vendor-client";

const PORT = Number(process.env.PORT ?? 4000);

const API_KEY = process.env.VENDOR_API_KEY;
const VENDOR_BASE_URL = process.env.VENDOR_API_BASE_URL ?? "http://localhost:4001";

if (!API_KEY) {
  console.error(
    "VENDOR_API_KEY must be set — the vendor API key must never be defaulted or hardcoded (see .env.example)"
  );
  process.exit(1);
}

// The ONLY place the vendor API key exists in this app: constructed
// once here, held privately inside the client. Routes receive the
// client via dependency injection — they couldn't leak the key if
// they tried.
const vendorClient = new VendorQuoteClient({
  baseUrl: VENDOR_BASE_URL,
  apiKey: API_KEY,
});

createApp({ quoteService: vendorClient }).listen(PORT, () => {
  console.log(`[quote-service] listening on :${PORT}, vendor at ${VENDOR_BASE_URL}`);
});
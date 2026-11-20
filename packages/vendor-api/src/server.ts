// Thin launcher: reads env, creates the app, listens.

import { createApp } from "./app";

const PORT = Number(process.env.PORT ?? 4001);
const API_KEY = process.env.VENDOR_API_KEY;

if (!API_KEY) {
  console.error("VENDOR_API_KEY must be set (see .env.example)");
  process.exit(1);
}

// Optional override so the error path can be demonstrated on demand:
// quote-service retries, so at the default rate users rarely see a failure.
const FAILURE_RATE_ENV = process.env.VENDOR_FAILURE_RATE;
const FAILURE_RATE = FAILURE_RATE_ENV === undefined ? undefined : Number(FAILURE_RATE_ENV);

if (FAILURE_RATE !== undefined && !(FAILURE_RATE >= 0 && FAILURE_RATE <= 1)) {
  console.error(`VENDOR_FAILURE_RATE must be a number from 0 to 1 (got "${FAILURE_RATE_ENV}")`);
  process.exit(1);
}

// Omit failureRate entirely when unset: an explicit undefined would
// override the app's default.
createApp({ apiKey: API_KEY, ...(FAILURE_RATE !== undefined && { failureRate: FAILURE_RATE }) }).listen(PORT, () => {
  console.log(`[vendor-api] mock Commission Quote API listening on :${PORT}`);
});

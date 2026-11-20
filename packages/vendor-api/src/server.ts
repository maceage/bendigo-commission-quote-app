// Thin launcher: reads env, creates the app, listens.

import { createApp } from "./app";
import { createLogger } from "./logger";

const logger = createLogger();

const PORT = Number(process.env.PORT ?? 4001);
const API_KEY = process.env.VENDOR_API_KEY;

if (!API_KEY) {
  logger.fatal("VENDOR_API_KEY must be set (see .env.example)");
  process.exit(1);
}

/** Reads an optional 0-1 probability from the environment; exits if it is invalid. */
function rateFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const rate = Number(raw);
  if (!(rate >= 0 && rate <= 1)) {
    logger.fatal(`${name} must be a number from 0 to 1 (got "${raw}")`);
    process.exit(1);
  }
  return rate;
}

// Optional overrides so the error paths can be demonstrated on demand:
// quote-service retries, so at the default rates users rarely see a failure.
const FAILURE_RATE = rateFromEnv("VENDOR_FAILURE_RATE");
const TIMEOUT_RATE = rateFromEnv("VENDOR_TIMEOUT_RATE");

// Omit unset rates entirely: an explicit undefined would override the
// app's defaults.
createApp({
  apiKey: API_KEY,
  logger,
  ...(FAILURE_RATE !== undefined && { failureRate: FAILURE_RATE }),
  ...(TIMEOUT_RATE !== undefined && { timeoutRate: TIMEOUT_RATE }),
}).listen(PORT, () => {
  logger.info({ port: PORT }, "mock Commission Quote API listening");
});

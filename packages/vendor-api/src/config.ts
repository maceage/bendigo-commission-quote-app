// Reads and validates the vendor's settings from the environment. Kept
// out of server.ts so the rules can be tested without starting a
// server; server.ts logs a ConfigError and exits.

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export interface VendorConfig {
  port: number;
  apiKey: string;
  /** Absent when unset, so the app's default applies (an explicit undefined would override it). */
  failureRate?: number;
  timeoutRate?: number;
  /** Where issued quotes are kept across restarts; absent means in memory only. */
  idempotencyFile?: string;
}

/** An optional 0-1 probability. Empty counts as unset, since Compose passes unset settings as "". */
function rateFromEnv(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const rate = Number(raw);
  if (!(rate >= 0 && rate <= 1)) {
    throw new ConfigError(`${name} must be a number from 0 to 1 (got "${raw}")`);
  }
  return rate;
}

/** An optional TCP port, else the default. Empty counts as unset, since Compose passes unset settings as "". */
function portFromEnv(env: NodeJS.ProcessEnv, fallback: number): number {
  const raw = env.PORT;
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!(Number.isInteger(port) && port >= 1 && port <= 65535)) {
    throw new ConfigError(`PORT must be a whole number from 1 to 65535 (got "${raw}")`);
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VendorConfig {
  const apiKey = env.VENDOR_API_KEY;
  if (!apiKey) throw new ConfigError("VENDOR_API_KEY must be set (see .env.example)");

  // Optional overrides so the error paths can be demonstrated on demand:
  // quote-service retries, so at the default rates users rarely see a failure.
  const failureRate = rateFromEnv(env, "VENDOR_FAILURE_RATE");
  const timeoutRate = rateFromEnv(env, "VENDOR_TIMEOUT_RATE");
  const idempotencyFile = env.VENDOR_IDEMPOTENCY_FILE || undefined;

  return {
    port: portFromEnv(env, 4001),
    apiKey,
    ...(failureRate !== undefined && { failureRate }),
    ...(timeoutRate !== undefined && { timeoutRate }),
    ...(idempotencyFile !== undefined && { idempotencyFile }),
  };
}

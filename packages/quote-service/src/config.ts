// Reads and validates quote-service's settings from the environment.
// Kept out of server.ts so the rules can be tested without starting a
// server; server.ts logs a ConfigError and exits.

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export interface QuoteServiceConfig {
  port: number;
  apiKey: string;
  vendorBaseUrl: string;
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

/** The vendor's base URL, without a trailing slash (the client adds "/quotes"). */
function vendorUrlFromEnv(env: NodeJS.ProcessEnv): string {
  const raw = env.VENDOR_API_BASE_URL || "http://localhost:4001";
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    // Reported below with the other bad values.
  }
  if (url === undefined || !["http:", "https:"].includes(url.protocol)) {
    throw new ConfigError(`VENDOR_API_BASE_URL must be an http or https URL (got "${raw}")`);
  }
  return raw.replace(/\/+$/, "");
}

/** Empty settings count as unset, since Compose passes unset settings as "". */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): QuoteServiceConfig {
  const apiKey = env.VENDOR_API_KEY;
  if (!apiKey) {
    throw new ConfigError(
      "VENDOR_API_KEY must be set — the vendor API key must never be defaulted or hardcoded (see .env.example)",
    );
  }

  return {
    port: portFromEnv(env, 4000),
    apiKey,
    vendorBaseUrl: vendorUrlFromEnv(env),
  };
}

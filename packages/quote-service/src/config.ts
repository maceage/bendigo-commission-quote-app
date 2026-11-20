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

/** Empty settings count as unset, since Compose passes unset settings as "". */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): QuoteServiceConfig {
  const apiKey = env.VENDOR_API_KEY;
  if (!apiKey) {
    throw new ConfigError(
      "VENDOR_API_KEY must be set — the vendor API key must never be defaulted or hardcoded (see .env.example)",
    );
  }

  return {
    port: Number(env.PORT || 4000),
    apiKey,
    vendorBaseUrl: env.VENDOR_API_BASE_URL || "http://localhost:4001",
  };
}

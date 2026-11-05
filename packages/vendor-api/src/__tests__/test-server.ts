// Tiny helper: boots an Express app on an ephemeral port (0) for the
// duration of a test, exposes a base URL, cleans up after.

import type { Express } from "express";

export async function startApp(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

export const VALID_KEY = "test-vendor-key-123";
export const QUOTE_ENDPOINT = "/quotes";

export function quotePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    loanAmount: 250_000,
    loanTermInMonths: 36,
    riskBand: "MEDIUM",
    ...overrides,
  });
}


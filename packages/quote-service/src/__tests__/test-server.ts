// Same helper, duplicated per package (a 15-line file is cheaper
// than a cross-package test-utils workspace at this scale).

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

export function loanPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    loanAmount: 250_000,
    loanTermInMonths: 36,
    riskBand: "MEDIUM",
    ...overrides,
  });
}
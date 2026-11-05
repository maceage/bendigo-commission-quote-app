// The retry seam, tested against a real (tiny) throwaway HTTP server
// pretending to be the vendor. Exercises timeout and retry paths
// with small, fast values injected via config.

import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { VendorQuoteClient } from "../services/vendor-client";

const KEY = "test-vendor-key-123";
const REQUEST = { loanAmount: 250_000, loanTermInMonths: 36, riskBand: "MEDIUM" as const };
const GOOD_RESPONSE = JSON.stringify({
  quoteId: "22222222-2222-4222-8222-222222222222",
  commissionRate: 0.035,
  totalCommission: 8750,
});

interface StubVendorOptions {
  /** Statuses to return, in order; last one repeats. */
  statuses: number[];
  /** Delay before responding, to trigger client timeouts. */
  delayMs?: number;
}

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

async function startVendor({ statuses, delayMs = 0 }: StubVendorOptions): Promise<string> {
  let call = 0;
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      call++;
      const status = statuses[Math.min(call - 1, statuses.length - 1)] ?? 500;

      if (req.headers["x-api-key"] !== KEY) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized." }));
        return;
      }

      setTimeout(() => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(status === 200 ? GOOD_RESPONSE : JSON.stringify({ error: "boom" }));
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

function makeClient(baseUrl: string) {
  return new VendorQuoteClient({
    baseUrl,
    apiKey: KEY,
    timeoutMs: 500,
    maxAttempts: 3,
    baseDelayMs: 10, // fast backoff — tests stay quick
  });
}

describe("VendorQuoteClient", () => {
  it("returns the quote when the vendor succeeds immediately", async () => {
    const baseUrl = await startVendor({ statuses: [200] });
    const quote = await makeClient(baseUrl).generateQuote(REQUEST);
    expect(quote.totalCommission).toBe(8750);
  });

  it("retries a 500 and succeeds on the second attempt", async () => {
    const baseUrl = await startVendor({ statuses: [500, 200] });
    const quote = await makeClient(baseUrl).generateQuote(REQUEST);
    expect(quote.quoteId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("gives up with SERVICE_UNAVAILABLE after exhausting retries", async () => {
    const baseUrl = await startVendor({ statuses: [500] }); // always 500
    const err = await makeClient(baseUrl).generateQuote(REQUEST).catch((e) => e);
    expect(err.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("times out and reports VENDOR_TIMEOUT when the vendor hangs", async () => {
    // 2s delay vs 500ms timeout: every attempt expires.
    const baseUrl = await startVendor({ statuses: [200], delayMs: 2_000 });
    const err = await makeClient(baseUrl).generateQuote(REQUEST).catch((e) => e);
    expect(err.code).toBe("VENDOR_TIMEOUT");
  });

  it("does NOT retry a malformed 200 response (fails fast)", async () => {
    // Vendor returns 200 but garbage shape — contract violation.
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ surprise: "i am not a quote" }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    const err = await makeClient(`http://127.0.0.1:${port}`)
      .generateQuote(REQUEST)
      .catch((e) => e);
    expect(err.code).toBe("VENDOR_ERROR");
  });
});

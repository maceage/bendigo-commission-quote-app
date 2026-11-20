// The retry seam, tested against a real (tiny) throwaway HTTP server
// pretending to be the vendor. Exercises timeout and retry paths
// with small, fast values injected via config.

import { describe, it, expect, afterEach } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { API_KEY_HEADER, REQUEST_ID_HEADER } from "@commission-quote/contract";
import { VendorClientError, VendorQuoteClient, type VendorClientConfig } from "../../src/services/vendor-client";
import { captureLogs } from "../test-server";

const KEY = "test-vendor-key-123";
const REQUEST = { loanAmount: 250_000, loanTermInMonths: 36, riskBand: "MEDIUM" as const };
const GOOD_RESPONSE = JSON.stringify({
  quoteId: "22222222-2222-4222-8222-222222222222",
  commissionRate: 0.035,
  totalCommission: 8750,
});

let server: Server | undefined;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

type Handler = (req: IncomingMessage, res: ServerResponse, call: number) => void;

/** Starts a stub vendor; the handler sees every request (after auth). */
async function startVendor(handler: Handler): Promise<{ url: string; requests: IncomingMessage[] }> {
  const requests: IncomingMessage[] = [];
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests.push(req);
      if (req.headers[API_KEY_HEADER] !== KEY) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized." }));
        return;
      }
      handler(req, res, requests.length);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, requests };
}

/** Returns statuses in order; the last one repeats. */
function statuses(list: number[], delayMs = 0): Handler {
  return (_req, res, call) => {
    const status = list[Math.min(call - 1, list.length - 1)] ?? 500;
    setTimeout(() => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(status === 200 ? GOOD_RESPONSE : JSON.stringify({ error: "boom" }));
    }, delayMs);
  };
}

function makeClient(baseUrl: string, overrides: Partial<VendorClientConfig> = {}) {
  return new VendorQuoteClient({
    baseUrl,
    apiKey: KEY,
    timeoutMs: 300,
    totalTimeoutMs: 5_000,
    maxAttempts: 3,
    baseDelayMs: 10, // fast backoff — tests stay quick
    ...overrides,
  });
}

async function failureOf(promise: Promise<unknown>): Promise<VendorClientError> {
  const err = await promise.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(VendorClientError);
  return err as VendorClientError;
}

describe("VendorQuoteClient", () => {
  it("returns the quote when the vendor succeeds immediately", async () => {
    const { url } = await startVendor(statuses([200]));
    const quote = await makeClient(url).generateQuote(REQUEST);
    expect(quote.totalCommission).toBe(8750);
  });

  it("accepts a vendor quoteId that is not a UUID", async () => {
    const { url } = await startVendor((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ quoteId: "Q-12345", commissionRate: 0.035, totalCommission: 8750 }));
    });
    const quote = await makeClient(url).generateQuote(REQUEST);
    expect(quote.quoteId).toBe("Q-12345");
  });

  it("rejects an empty quoteId as malformed", async () => {
    const { url } = await startVendor((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ quoteId: "", commissionRate: 0.035, totalCommission: 8750 }));
    });
    const err = await failureOf(makeClient(url).generateQuote(REQUEST));
    expect(err.code).toBe("VENDOR_ERROR");
  });

  it("retries a 500 and succeeds on the second attempt", async () => {
    const { url, requests } = await startVendor(statuses([500, 200]));
    const quote = await makeClient(url).generateQuote(REQUEST);
    expect(quote.quoteId).toBe("22222222-2222-4222-8222-222222222222");
    expect(requests).toHaveLength(2);
  });

  it("sends the SAME idempotency key on every retry of one request", async () => {
    const { url, requests } = await startVendor(statuses([500, 500, 200]));
    await makeClient(url).generateQuote(REQUEST);
    const keys = requests.map((r) => r.headers["idempotency-key"]);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("forwards the request ID to the vendor on every attempt", async () => {
    const { url, requests } = await startVendor(statuses([500, 200]));
    const { logger } = captureLogs();
    await makeClient(url).generateQuote(REQUEST, { requestId: "req-42", log: logger });
    expect(requests.map((r) => r.headers[REQUEST_ID_HEADER])).toEqual(["req-42", "req-42"]);
  });

  it("logs each attempt: the failure with its status, the retry, then the success", async () => {
    const { url } = await startVendor(statuses([503, 200]));
    const { logger, lines } = captureLogs();
    await makeClient(url).generateQuote(REQUEST, { requestId: "req-42", log: logger });

    expect(lines.map((l) => l.msg)).toEqual(["vendor attempt failed", "retrying vendor call", "vendor quote received"]);
    expect(lines[0]).toMatchObject({ attempt: 1, code: "SERVICE_UNAVAILABLE", status: 503 });
    expect(lines[2]).toMatchObject({ attempt: 2, quoteId: "22222222-2222-4222-8222-222222222222" });
  });

  it("uses a fresh idempotency key for each new request", async () => {
    const { url, requests } = await startVendor(statuses([200]));
    const client = makeClient(url);
    await client.generateQuote(REQUEST);
    await client.generateQuote(REQUEST);
    expect(requests[0]?.headers["idempotency-key"]).not.toBe(requests[1]?.headers["idempotency-key"]);
  });

  it("gives up with SERVICE_UNAVAILABLE after exhausting retries", async () => {
    const { url, requests } = await startVendor(statuses([500]));
    const err = await failureOf(makeClient(url).generateQuote(REQUEST));
    expect(err.code).toBe("SERVICE_UNAVAILABLE");
    expect(requests).toHaveLength(3);
  });

  it("retries 429 and honours Retry-After", async () => {
    const { url } = await startVendor((_req, res, call) => {
      if (call === 1) {
        res.writeHead(429, { "retry-after": "0.2" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(GOOD_RESPONSE);
    });
    const started = Date.now();
    await makeClient(url).generateQuote(REQUEST);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });

  it("times out and reports VENDOR_TIMEOUT when the vendor hangs", async () => {
    const { url } = await startVendor(statuses([200], 2_000));
    const err = await failureOf(makeClient(url).generateQuote(REQUEST));
    expect(err.code).toBe("VENDOR_TIMEOUT");
  });

  it("reports VENDOR_TIMEOUT when the vendor stalls mid-body (headers sent, body never finishes)", async () => {
    // Regression: the timeout used to escape from response.json() as a
    // raw DOMException instead of a typed error.
    const { url } = await startVendor((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"quoteId":');
      // ...and never end.
    });
    const err = await failureOf(makeClient(url, { maxAttempts: 1 }).generateQuote(REQUEST));
    expect(err.code).toBe("VENDOR_TIMEOUT");
  });

  it("enforces the overall deadline across attempts", async () => {
    const { url, requests } = await startVendor(statuses([200], 2_000));
    const started = Date.now();
    const err = await failureOf(
      makeClient(url, { timeoutMs: 1_000, totalTimeoutMs: 400, maxAttempts: 5 }).generateQuote(REQUEST),
    );
    expect(err.code).toBe("VENDOR_TIMEOUT");
    expect(Date.now() - started).toBeLessThan(900);
    expect(requests).toHaveLength(1);
  });

  it("does NOT retry a malformed 200 response (fails fast)", async () => {
    const { url, requests } = await startVendor((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ surprise: "i am not a quote" }));
    });
    const err = await failureOf(makeClient(url).generateQuote(REQUEST));
    expect(err.code).toBe("VENDOR_ERROR");
    expect(requests).toHaveLength(1);
  });

  it("reports VENDOR_ERROR for a 200 whose body isn't JSON", async () => {
    const { url } = await startVendor((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>oops</html>");
    });
    const err = await failureOf(makeClient(url).generateQuote(REQUEST));
    expect(err.code).toBe("VENDOR_ERROR");
  });

  it("does NOT retry a 401 (misconfigured key)", async () => {
    const { url, requests } = await startVendor(statuses([200]));
    const err = await failureOf(makeClient(url, { apiKey: "wrong" }).generateQuote(REQUEST));
    expect(err.code).toBe("VENDOR_ERROR");
    expect(requests).toHaveLength(1);
  });

  it("reports SERVICE_UNAVAILABLE when the vendor is unreachable", async () => {
    // Port 1 on loopback: connection refused.
    const err = await failureOf(makeClient("http://127.0.0.1:1").generateQuote(REQUEST));
    expect(err.code).toBe("SERVICE_UNAVAILABLE");
  });
});

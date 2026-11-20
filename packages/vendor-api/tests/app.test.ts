// Contract shape, validation, the simulated failure behaviour, and the
// error responses and health check.
// failureRate 0/1 makes the "random" simulation deterministic.

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_KEY_HEADER, QuoteResponseSchema, type QuoteResponse } from "@commission-quote/contract";
import { createApp } from "../src/app";
import { startApp, captureLogs, VALID_KEY, QUOTE_ENDPOINT, quotePayload } from "./test-server";

let harness: Awaited<ReturnType<typeof startApp>> | undefined;

afterEach(async () => {
  await harness?.close();
});

async function post(body: string, headers: Record<string, string> = {}) {
  return fetch(`${harness!.url}${QUOTE_ENDPOINT}`, {
    method: "POST",
    headers: { "content-type": "application/json", [API_KEY_HEADER]: VALID_KEY, ...headers },
    body,
  });
}

const reliable = () => createApp({ apiKey: VALID_KEY, failureRate: 0, timeoutRate: 0, latencyMs: [0, 0] });

describe("POST /quotes", () => {
  it("returns a contract-valid quote for valid loan details", async () => {
    harness = await startApp(reliable());
    const res = await post(quotePayload());
    expect(res.status).toBe(200);

    const body = (await res.json()) as QuoteResponse;
    // The strongest assertion we can make: the response validates
    // against the SAME shared schema the quote-service trusts. If the
    // vendor drifts from the contract, this test is the alarm.
    expect(QuoteResponseSchema.safeParse(body).success).toBe(true);

    // Sanity on the math: MEDIUM = 3.5% of 250,000 = 8,750, as an exact decimal string.
    expect(body.totalCommission).toBe("8750.00");
    expect(body.commissionRate).toBe(0.035);
  });

  it("returns 400 for a negative loan amount", async () => {
    harness = await startApp(reliable());
    const res = await post(quotePayload({ loanAmount: "-100" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an out-of-enum risk band", async () => {
    harness = await startApp(reliable());
    const res = await post(quotePayload({ riskBand: "EXTREME" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a loan amount sent as a JSON number, which a client would parse as a float", async () => {
    harness = await startApp(reliable());
    const res = await post(quotePayload({ loanAmount: 250000 }));
    expect(res.status).toBe(400);
  });

  it("simulates a vendor 500 when failureRate is 1", async () => {
    // Injection point proves the simulation knob actually works —
    // and gives quote-service a way to force-fail in ITS tests.
    harness = await startApp(createApp({ apiKey: VALID_KEY, failureRate: 1, latencyMs: [0, 0] }));
    const res = await post(quotePayload());
    expect(res.status).toBe(500);
  });

  it("never responds when timeoutRate is 1", async () => {
    harness = await startApp(createApp({ apiKey: VALID_KEY, failureRate: 0, timeoutRate: 1, latencyMs: [0, 0] }));
    const request = fetch(`${harness.url}${QUOTE_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json", [API_KEY_HEADER]: VALID_KEY },
      body: quotePayload(),
      signal: AbortSignal.timeout(200),
    });
    await expect(request).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("returns 400 for a malformed JSON body", async () => {
    harness = await startApp(reliable());
    const res = await post("{not json");
    expect(res.status).toBe(400);
  });

  it("returns the SAME quote for a repeated Idempotency-Key", async () => {
    harness = await startApp(reliable());
    const headers = { "idempotency-key": "retry-me" };
    const first = (await (await post(quotePayload(), headers)).json()) as QuoteResponse;
    const second = (await (await post(quotePayload(), headers)).json()) as QuoteResponse;
    expect(second.quoteId).toBe(first.quoteId);
  });

  it("returns the original quote for a replay that writes the same amount differently", async () => {
    harness = await startApp(reliable());
    const headers = { "idempotency-key": "same-loan" };
    const first = (await (await post(quotePayload({ loanAmount: "250000" }), headers)).json()) as QuoteResponse;
    const second = (await (await post(quotePayload({ loanAmount: "250000.00" }), headers)).json()) as QuoteResponse;
    expect(second.quoteId).toBe(first.quoteId);
  });

  it("refuses with 422 an Idempotency-Key reused for a different loan, and keeps the original", async () => {
    const { logger, lines } = captureLogs();
    harness = await startApp(
      createApp({ apiKey: VALID_KEY, failureRate: 0, timeoutRate: 0, latencyMs: [0, 0], logger }),
    );
    const headers = { "idempotency-key": "one-loan" };
    const original = (await (await post(quotePayload(), headers)).json()) as QuoteResponse;

    const reused = await post(quotePayload({ riskBand: "HIGH" }), headers);
    expect(reused.status).toBe(422);
    expect(await reused.json()).toEqual({ error: "Idempotency-Key was already used for a different request." });
    const logged = lines.map((line) => JSON.parse(line) as { msg?: string });
    expect(logged).toContainEqual(expect.objectContaining({ msg: "idempotency key reused for a different request" }));

    const replay = (await (await post(quotePayload(), headers)).json()) as QuoteResponse;
    expect(replay.quoteId).toBe(original.quoteId);
  });

  it("rejects an invalid body even when its Idempotency-Key was used before", async () => {
    harness = await startApp(reliable());
    const headers = { "idempotency-key": "then-invalid" };
    await post(quotePayload(), headers);
    expect((await post(quotePayload({ loanAmount: "-1" }), headers)).status).toBe(400);
  });

  it("issues distinct quotes for distinct (or absent) Idempotency-Keys", async () => {
    harness = await startApp(reliable());
    const a = (await (await post(quotePayload(), { "idempotency-key": "a" })).json()) as QuoteResponse;
    const b = (await (await post(quotePayload(), { "idempotency-key": "b" })).json()) as QuoteResponse;
    const c = (await (await post(quotePayload())).json()) as QuoteResponse;
    expect(new Set([a.quoteId, b.quoteId, c.quoteId]).size).toBe(3);
  });
});

describe("error responses and health check", () => {
  it("returns 413 for a body over the 10kb limit", async () => {
    harness = await startApp(reliable());
    const res = await post(quotePayload({ padding: "x".repeat(11_000) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Request payload too large." });
  });

  it("returns an opaque 500 for an unexpected error, and logs the details", async () => {
    const { logger, lines } = captureLogs();
    // A roll that throws stands in for any unexpected bug in the handler.
    const random = () => {
      throw new Error("secret internal details");
    };
    harness = await startApp(createApp({ apiKey: VALID_KEY, latencyMs: [0, 0], random, logger }));

    const res = await post(quotePayload());
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "Internal vendor error." });
    expect(body).not.toContain("secret internal details");

    const logged = lines.map((line) => JSON.parse(line) as { msg?: string; err?: { message?: string } });
    expect(logged).toContainEqual(
      expect.objectContaining({
        msg: "unexpected failure",
        err: expect.objectContaining({ message: "secret internal details" }),
      }),
    );
  });

  it("answers /healthz without an API key (Compose's health check has none), and doesn't log it", async () => {
    const { logger, lines } = captureLogs();
    harness = await startApp(createApp({ apiKey: VALID_KEY, logger }));

    const res = await fetch(`${harness.url}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });

    await fetch(`${harness.url}${QUOTE_ENDPOINT}`, { method: "POST" }); // logged, to prove logging works
    expect(lines.join("")).toContain(QUOTE_ENDPOINT);
    expect(lines.join("")).not.toContain("/healthz");
  });
});

describe("idempotency store", () => {
  const small = () =>
    createApp({ apiKey: VALID_KEY, failureRate: 0, timeoutRate: 0, latencyMs: [0, 0], idempotencyCacheSize: 2 });

  async function quoteFor(key: string): Promise<string> {
    const res = await post(quotePayload(), { "idempotency-key": key });
    return ((await res.json()) as QuoteResponse).quoteId;
  }

  it("forgets the oldest key once full, and keeps the rest", async () => {
    harness = await startApp(small());
    const a = await quoteFor("a");
    const b = await quoteFor("b");
    const c = await quoteFor("c"); // third key in a store of two: "a" is dropped

    // Check the kept keys first: replaying a forgotten key issues a new
    // quote, which would itself push another key out.
    expect(await quoteFor("b")).toBe(b);
    expect(await quoteFor("c")).toBe(c);
    expect(await quoteFor("a")).not.toBe(a);
  });

  it("drops keys in the order they were issued, even if one was just replayed", async () => {
    harness = await startApp(small());
    const a = await quoteFor("a");
    await quoteFor("b");
    expect(await quoteFor("a")).toBe(a); // a replay doesn't move "a" to the back
    await quoteFor("c");

    expect(await quoteFor("a")).not.toBe(a);
  });

  it("issues a new quote for a key whose time is up", async () => {
    harness = await startApp(
      createApp({ apiKey: VALID_KEY, failureRate: 0, timeoutRate: 0, latencyMs: [0, 0], idempotencyTtlMs: 0 }),
    );
    const first = await quoteFor("expires-at-once");
    expect(await quoteFor("expires-at-once")).not.toBe(first);
  });

  it("returns the original quote after a restart when given a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vendor-"));
    const withFile = () =>
      createApp({
        apiKey: VALID_KEY,
        failureRate: 0,
        timeoutRate: 0,
        latencyMs: [0, 0],
        idempotencyFile: join(dir, "issued.json"),
      });
    try {
      harness = await startApp(withFile());
      const original = await quoteFor("before-restart");
      await harness.close();

      harness = await startApp(withFile());
      expect(await quoteFor("before-restart")).toBe(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

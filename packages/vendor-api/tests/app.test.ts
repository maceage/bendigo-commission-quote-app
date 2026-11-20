// Contract shape, validation, and the simulated failure behaviour.
// failureRate 0/1 makes the "random" simulation deterministic.

import { describe, it, expect, afterEach } from "vitest";
import { API_KEY_HEADER, QuoteResponseSchema, type QuoteResponse } from "@commission-quote/contract";
import { createApp } from "../src/app";
import { startApp, VALID_KEY, QUOTE_ENDPOINT, quotePayload } from "./test-server";

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

    // Sanity on the math: MEDIUM = 3.5% of 250,000 = 8,750.
    expect(body.totalCommission).toBe(8750);
    expect(body.commissionRate).toBe(0.035);
  });

  it("returns 400 for a negative loan amount", async () => {
    harness = await startApp(reliable());
    const res = await post(quotePayload({ loanAmount: -100 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an out-of-enum risk band", async () => {
    harness = await startApp(reliable());
    const res = await post(quotePayload({ riskBand: "EXTREME" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for string-typed numbers (classic form-output bug)", async () => {
    harness = await startApp(reliable());
    const res = await post(quotePayload({ loanAmount: "250000" }));
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

  it("issues distinct quotes for distinct (or absent) Idempotency-Keys", async () => {
    harness = await startApp(reliable());
    const a = (await (await post(quotePayload(), { "idempotency-key": "a" })).json()) as QuoteResponse;
    const b = (await (await post(quotePayload(), { "idempotency-key": "b" })).json()) as QuoteResponse;
    const c = (await (await post(quotePayload())).json()) as QuoteResponse;
    expect(new Set([a.quoteId, b.quoteId, c.quoteId]).size).toBe(3);
  });
});

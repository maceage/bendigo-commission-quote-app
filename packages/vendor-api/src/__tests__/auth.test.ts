// THE security requirement from the brief: no valid key, no service.

import { describe, it, expect, afterEach } from "vitest";
import { createApp } from "../app";
import { startApp, VALID_KEY, QUOTE_ENDPOINT, quotePayload } from "./test-server";

let harness: Awaited<ReturnType<typeof startApp>> | undefined;

afterEach(async () => {
  await harness?.close();
});

describe("api-key auth", () => {
  it("rejects requests with no API key", async () => {
    harness = await startApp(createApp({ apiKey: VALID_KEY }));
    const res = await fetch(`${harness.url}${QUOTE_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: quotePayload(),
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with a wrong API key", async () => {
    harness = await startApp(createApp({ apiKey: VALID_KEY }));
    const res = await fetch(`${harness.url}${QUOTE_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "not-the-key" },
      body: quotePayload(),
    });
    expect(res.status).toBe(401);
  });

  it("admits requests with the correct API key", async () => {
    harness = await startApp(
      createApp({ apiKey: VALID_KEY, failureRate: 0, latencyMs: [0, 0] })
    );
    const res = await fetch(`${harness.url}${QUOTE_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": VALID_KEY },
      body: quotePayload(),
    });
    // 401 = auth blocked us; anything else means auth waved us through.
    expect(res.status).not.toBe(401);
  });
});
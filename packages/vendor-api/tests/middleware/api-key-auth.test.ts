// THE security requirement from the brief: no valid key, no service.

import { describe, it, expect, afterEach } from "vitest";
import { API_KEY_HEADER } from "@commission-quote/contract";
import { createApp } from "../../src/app";
import { startApp, captureLogs, VALID_KEY, QUOTE_ENDPOINT, quotePayload } from "../test-server";

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
      headers: { "content-type": "application/json", [API_KEY_HEADER]: "not-the-key" },
      body: quotePayload(),
    });
    expect(res.status).toBe(401);
  });

  it("admits requests with the correct API key", async () => {
    harness = await startApp(createApp({ apiKey: VALID_KEY, failureRate: 0, timeoutRate: 0, latencyMs: [0, 0] }));
    const res = await fetch(`${harness.url}${QUOTE_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json", [API_KEY_HEADER]: VALID_KEY },
      body: quotePayload(),
    });
    // 401 = auth blocked us; anything else means auth waved us through.
    expect(res.status).not.toBe(401);
  });

  it("never writes the API key to the logs", async () => {
    const { logger, lines } = captureLogs();
    harness = await startApp(
      createApp({ apiKey: VALID_KEY, failureRate: 0, timeoutRate: 0, latencyMs: [0, 0], logger }),
    );
    await fetch(`${harness.url}${QUOTE_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json", [API_KEY_HEADER]: VALID_KEY },
      body: quotePayload(),
    });

    const logged = lines.join("");
    expect(logged).toContain('"api-key":"[Redacted]"'); // the request line was written...
    expect(logged).not.toContain(VALID_KEY); // ...without the key
  });

  it("rejects a wrong key with as many characters but more bytes than the real one", async () => {
    harness = await startApp(createApp({ apiKey: VALID_KEY }));
    // "é" is one character but two bytes in UTF-8, so a byte-by-byte
    // compare that only checked the character count would throw here.
    const sameLength = `${VALID_KEY.slice(0, -1)}é`;
    const res = await fetch(`${harness.url}${QUOTE_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json", [API_KEY_HEADER]: sameLength },
      body: quotePayload(),
    });
    expect(res.status).toBe(401);
  });

  it("ignores a valid key sent under any other header name", async () => {
    harness = await startApp(createApp({ apiKey: VALID_KEY, failureRate: 0, timeoutRate: 0, latencyMs: [0, 0] }));
    const res = await fetch(`${harness.url}${QUOTE_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": VALID_KEY },
      body: quotePayload(),
    });
    expect(res.status).toBe(401);
  });
});

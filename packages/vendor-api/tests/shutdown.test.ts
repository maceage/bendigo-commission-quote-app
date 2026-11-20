import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { closeGracefully } from "../src/shutdown";
import { captureLogs } from "./test-server";

let server: Server | undefined;

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

/** A server that answers after `delayMs`, or never if it's undefined; resolves to its URL. */
async function listen(delayMs: number | undefined): Promise<string> {
  server = createServer((_req, res) => {
    if (delayMs !== undefined) setTimeout(() => res.end("done"), delayMs);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
}

/** Waits until the server has a request to handle. */
const requestArrived = () => new Promise<void>((resolve) => server!.once("request", () => resolve()));

describe("closeGracefully", () => {
  it("closes at once when nothing is running", async () => {
    await listen(0);
    const { logger } = captureLogs();
    const started = Date.now();
    expect(await closeGracefully(server!, { timeoutMs: 5_000, logger })).toEqual({ forced: false });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("lets a request in progress finish, then closes without waiting out keep-alive", async () => {
    const url = await listen(200);
    await (await fetch(url)).text(); // leaves an idle keep-alive connection open
    const response = fetch(url).then((res) => res.text());
    await requestArrived();

    const { logger } = captureLogs();
    const started = Date.now();
    const closed = closeGracefully(server!, { timeoutMs: 5_000, logger });

    expect(await response).toBe("done");
    expect(await closed).toEqual({ forced: false });
    // Well under the keep-alive timeout the reused connection would otherwise hold it open for.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("refuses new connections once it has started closing", async () => {
    const url = await listen(200);
    const inProgress = fetch(url).then((res) => res.text());
    await requestArrived();

    const { logger } = captureLogs();
    const closed = closeGracefully(server!, { timeoutMs: 5_000, logger });

    // A new connection, not the in-progress one: undici would otherwise queue on it.
    await expect(fetch(url, { headers: { connection: "close" }, keepalive: false })).rejects.toThrow();
    await inProgress;
    await closed;
  });

  it("cuts off a request still running at the time limit, and says so", async () => {
    const url = await listen(undefined);
    const response = fetch(url);
    await requestArrived();

    const { logger, lines } = captureLogs();
    expect(await closeGracefully(server!, { timeoutMs: 100, logger })).toEqual({ forced: true });
    await expect(response).rejects.toThrow();
    expect(JSON.stringify(lines)).toContain("shutdown time limit");
  });
});

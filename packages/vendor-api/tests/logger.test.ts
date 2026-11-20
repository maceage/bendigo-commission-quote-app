import { afterEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { REQUEST_ID_HEADER } from "@commission-quote/contract";
import { createLogger, requestId } from "../src/logger";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createLogger", () => {
  it("uses LOG_LEVEL when it is set", () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    expect(createLogger().level).toBe("warn");
  });

  it("treats an empty LOG_LEVEL as unset, as Compose passes it, instead of crashing", () => {
    vi.stubEnv("LOG_LEVEL", "");
    expect(createLogger().level).toBe("silent"); // the default under Vitest
  });

  it("defaults to info outside the tests, as in production", () => {
    vi.stubEnv("VITEST", "");
    expect(createLogger().level).toBe("info");
  });
});

describe("requestId", () => {
  /** Runs requestId for a request carrying `incoming` (if given); returns the ID and the header echoed back. */
  function idFor(incoming?: string) {
    const req = { headers: incoming === undefined ? {} : { [REQUEST_ID_HEADER]: incoming } } as IncomingMessage;
    const res = { setHeader: vi.fn() };
    const id = requestId(req, res as unknown as ServerResponse);
    return { id, echoed: res.setHeader.mock.calls[0] };
  }

  it("reuses quote-service's request ID, so both services log a request under one ID", () => {
    expect(idFor("abc-123_XYZ")).toEqual({ id: "abc-123_XYZ", echoed: [REQUEST_ID_HEADER, "abc-123_XYZ"] });
  });

  it.each([
    ["missing", undefined],
    ["too long", "x".repeat(65)],
    ["not a plain token", "id\nwith a new line"],
  ])("makes a new ID when the incoming one is %s", (_case, incoming) => {
    const { id, echoed } = idFor(incoming);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(echoed).toEqual([REQUEST_ID_HEADER, id]);
  });
});

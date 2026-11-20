import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";

const KEY = { VENDOR_API_KEY: "a-key" };

describe("loadConfig", () => {
  it.each([{}, { VENDOR_API_KEY: "" }])("refuses to start without an API key (%o)", (env) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/VENDOR_API_KEY must be set/);
  });

  it("defaults the port and leaves the rates unset, so the app's defaults apply", () => {
    // toEqual with no rate keys at all: an explicit undefined would
    // override createApp's defaults.
    expect(loadConfig(KEY)).toEqual({ port: 4001, apiKey: "a-key" });
  });

  it("reads the port and both rates", () => {
    const env = { ...KEY, PORT: "5001", VENDOR_FAILURE_RATE: "0.5", VENDOR_TIMEOUT_RATE: "0.25" };
    expect(loadConfig(env)).toEqual({ port: 5001, apiKey: "a-key", failureRate: 0.5, timeoutRate: 0.25 });
  });

  it("treats empty settings as unset, as Compose passes them", () => {
    const env = { ...KEY, PORT: "", VENDOR_FAILURE_RATE: "", VENDOR_TIMEOUT_RATE: "", VENDOR_IDEMPOTENCY_FILE: "" };
    expect(loadConfig(env)).toEqual({ port: 4001, apiKey: "a-key" });
  });

  it("reads the idempotency file's path", () => {
    expect(loadConfig({ ...KEY, VENDOR_IDEMPOTENCY_FILE: "/data/issued.json" })).toEqual({
      port: 4001,
      apiKey: "a-key",
      idempotencyFile: "/data/issued.json",
    });
  });

  it("accepts the boundary rates 0 and 1 (0 is a real setting, not unset)", () => {
    expect(loadConfig({ ...KEY, VENDOR_FAILURE_RATE: "0", VENDOR_TIMEOUT_RATE: "1" })).toMatchObject({
      failureRate: 0,
      timeoutRate: 1,
    });
  });

  it.each(["abc", "1.5", "-0.1", "NaN"])("rejects an invalid rate (%s)", (value) => {
    expect(() => loadConfig({ ...KEY, VENDOR_FAILURE_RATE: value })).toThrow(
      `VENDOR_FAILURE_RATE must be a number from 0 to 1 (got "${value}")`,
    );
    expect(() => loadConfig({ ...KEY, VENDOR_TIMEOUT_RATE: value })).toThrow(ConfigError);
  });
  it.each(["abc", "0", "65536", "40.5", "-1"])("rejects an invalid port (%s)", (value) => {
    expect(() => loadConfig({ ...KEY, PORT: value })).toThrow(ConfigError);
    expect(() => loadConfig({ ...KEY, PORT: value })).toThrow(
      `PORT must be a whole number from 1 to 65535 (got "${value}")`,
    );
  });
});

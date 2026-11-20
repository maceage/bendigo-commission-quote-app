import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";

const KEY = { VENDOR_API_KEY: "a-key" };

describe("loadConfig", () => {
  it.each([{}, { VENDOR_API_KEY: "" }])("refuses to start without an API key (%o)", (env) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/VENDOR_API_KEY must be set/);
  });

  it("defaults the port and the vendor's URL", () => {
    expect(loadConfig(KEY)).toEqual({ port: 4000, apiKey: "a-key", vendorBaseUrl: "http://localhost:4001" });
  });

  it("reads the port and the vendor's URL", () => {
    const env = { ...KEY, PORT: "5000", VENDOR_API_BASE_URL: "http://vendor-api:4001" };
    expect(loadConfig(env)).toEqual({ port: 5000, apiKey: "a-key", vendorBaseUrl: "http://vendor-api:4001" });
  });

  it("treats empty settings as unset, as Compose passes them", () => {
    const env = { ...KEY, PORT: "", VENDOR_API_BASE_URL: "" };
    expect(loadConfig(env)).toEqual({ port: 4000, apiKey: "a-key", vendorBaseUrl: "http://localhost:4001" });
  });
});

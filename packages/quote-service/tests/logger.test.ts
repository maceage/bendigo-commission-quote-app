import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger";

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
});

import { defineConfig } from "vitest/config";
import { coverageOptions } from "../../vitest.shared";

export default defineConfig({
  // server.ts is the launcher; tests use createApp, so it's left out.
  test: { coverage: coverageOptions(["src/server.ts"]) },
});

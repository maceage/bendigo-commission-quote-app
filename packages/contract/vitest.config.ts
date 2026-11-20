import { defineConfig } from "vitest/config";
import { coverageOptions } from "../../vitest.shared";

export default defineConfig({
  // index.ts only re-exports, so it's left out.
  test: { coverage: coverageOptions(["src/index.ts"]) },
});

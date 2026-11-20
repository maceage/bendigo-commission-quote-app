/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { coverageOptions } from "../../vitest.shared";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Browser calls /api/quotes -> Vite proxies to quote-service:4000.
      // Avoids CORS entirely: same-origin from the browser's perspective.
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    coverage: coverageOptions(),
  },
});

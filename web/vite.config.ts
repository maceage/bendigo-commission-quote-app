import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // import from '@contract/...' instead of brittle relative paths
      // like ../../../contract/src when the front-end needs the types
      "@contract": path.resolve(__dirname, "../contract/src/index.ts"),
    },
  },
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
});
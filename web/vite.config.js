import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

// https://vitejs.dev/config/
// Note: vite-plugin-top-level-await is intentionally omitted.
// With target: "esnext", Vite/Rollup natively supports top-level await.
// The plugin crashes on Node 24 / newer @swc/core (missing `type` field).
export default defineConfig({
  plugins: [
    react(),
    wasm(),
  ],
  build: {
    target: "esnext", // enables native WASM + top-level-await support
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});

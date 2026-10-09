import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(), // allows `await init()` at module top level
  ],
  build: {
    target: "esnext", // required for WASM + top-level-await
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (if we ever add workers), harmless otherwise
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

// https://vitejs.dev/config/
// vite-plugin-top-level-await intentionally omitted:
// target "esnext" gives native TLA support; the plugin crashes on Node 24.
export default defineConfig({
  plugins: [react(), wasm()],
  build: {
    target: "esnext", // required for WASM modules + native top-level-await
  },
  // C11: COOP/COEP headers removed — only needed for SharedArrayBuffer/threads.
  // require-corp can block third-party resources; we don't use SharedArrayBuffer.
});

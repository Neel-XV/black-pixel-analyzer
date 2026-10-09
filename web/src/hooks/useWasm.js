/**
 * useWasm — lazy-initialises the pixel-engine WASM module on first call.
 *
 * The WASM module is a singleton: subsequent calls return the cached instance.
 * This avoids repeated network fetches of the .wasm binary.
 */

import { useEffect, useState } from "react";

let wasmModule = null;
let initPromise = null;

async function loadWasm() {
  if (wasmModule) return wasmModule;
  if (!initPromise) {
    initPromise = (async () => {
      // Dynamic import so Vite can code-split the WASM chunk
      const mod = await import("../wasm/pixel_engine.js");
      await mod.default(); // calls wasm-bindgen's `init()`
      wasmModule = mod;
      return mod;
    })();
  }
  return initPromise;
}

/**
 * @returns {{ wasm: object|null, loading: boolean, error: Error|null }}
 */
export function useWasm() {
  const [state, setState] = useState({
    wasm: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    loadWasm()
      .then((mod) => {
        if (!cancelled) setState({ wasm: mod, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ wasm: null, loading: false, error: err });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

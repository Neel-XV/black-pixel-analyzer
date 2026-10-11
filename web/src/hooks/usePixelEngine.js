/**
 * usePixelEngine
 *
 * Manages all per-image pixel processing state.  Designed so that the hot
 * path (slider drag) never allocates, never encodes a PNG, and never touches
 * React state for pixels.
 *
 * Implements C5 (histogram-based instant stats), C6 (blackify_into with
 * caller-owned buffer), B2 (keeps pixel work out of React render cycle),
 * and C12 (transparent pixel handling).
 */

import { useRef, useCallback } from "react";

export function usePixelEngine(wasm) {
  // Cumulative probability table: cum[t+1] = opaque pixels with max(r,g,b) <= t
  const cumRef = useRef(null);       // Float64Array[257]
  const totalOpaqueRef = useRef(0);

  // Output buffer — allocated ONCE per image, reused for every threshold change (C6)
  const dstUint8Ref = useRef(null);      // Uint8Array  (same buffer as dstImageData)
  const dstImageDataRef = useRef(null);  // ImageData wrapping dstUint8Ref

  // ── Initialise per-image state (call once after loading a new image) ────────
  const initImage = useCallback(
    (rawData, width, height) => {
      if (!wasm) return;

      // Build the 256-bin max-channel histogram via WASM (O(N) once)
      const srcUint8 = new Uint8Array(
        rawData.buffer,
        rawData.byteOffset,
        rawData.byteLength
      );
      const hist = wasm.max_histogram(srcUint8); // Uint32Array[256]

      // Build cumulative sum table in JS (trivial cost)
      const cum = new Float64Array(257);
      let running = 0;
      for (let i = 0; i < 256; i++) {
        running += hist[i];
        cum[i + 1] = running;
      }
      cumRef.current = cum;
      totalOpaqueRef.current = running; // sum of all bins = total opaque pixels

      // Allocate output buffer once for this image (C6)
      const byteLen = rawData.byteLength;
      const dstUint8 = new Uint8Array(byteLen);
      // ImageData shares the same underlying ArrayBuffer — no copy on putImageData
      const clampedView = new Uint8ClampedArray(dstUint8.buffer);
      const imageData = new ImageData(clampedView, width, height);

      dstUint8Ref.current = dstUint8;
      dstImageDataRef.current = imageData;
    },
    [wasm]
  );

  // ── Instant black-pixel percentage from the cumulative table (no WASM call) ─
  const pctAt = useCallback((threshold) => {
    const cum = cumRef.current;
    const total = totalOpaqueRef.current;
    if (!cum || total === 0) return 0;
    return (cum[Math.min(threshold, 255) + 1] / total) * 100;
  }, []);

  // ── Apply threshold and paint to a canvas context (hot path) ───────────────
  // Called from an rAF callback — no React state touched here.
  const applyToCanvas = useCallback(
    (srcData, ctx, threshold) => {
      if (!wasm || !dstUint8Ref.current || !dstImageDataRef.current) return;
      const srcUint8 = new Uint8Array(
        srcData.buffer,
        srcData.byteOffset,
        srcData.byteLength
      );
      // blackify_into writes into dstUint8Ref — zero allocation (C6)
      wasm.blackify_into(srcUint8, dstUint8Ref.current, threshold);
      // dstImageDataRef shares the same buffer → putImageData reads already-written bytes
      ctx.putImageData(dstImageDataRef.current, 0, 0);
    },
    [wasm]
  );

  // ── Reset all per-image state ───────────────────────────────────────────────
  const reset = useCallback(() => {
    cumRef.current = null;
    totalOpaqueRef.current = 0;
    dstUint8Ref.current = null;
    dstImageDataRef.current = null;
  }, []);

  const isReady = !!cumRef.current;

  return { initImage, pctAt, applyToCanvas, reset, isReady };
}

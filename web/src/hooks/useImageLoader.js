/**
 * useImageLoader
 *
 * Decodes an image File into raw RGBA pixel data using an off-screen canvas.
 * Returns an object URL for display (C3 — no toDataURL in live path).
 *
 * Uses a dedicated decode canvas, separate from the preview canvas (C13).
 */

import { useRef, useCallback } from "react";

export function useImageLoader() {
  // Dedicated canvas for decode only — never used for rendering (C13)
  const decodeCanvasRef = useRef(null);

  if (!decodeCanvasRef.current) {
    decodeCanvasRef.current = document.createElement("canvas");
  }

  /**
   * Decode a File/Blob into raw pixel data.
   *
   * @param {File} file
   * @returns {Promise<{ objectUrl: string, imageData: ImageData, width: number, height: number }>}
   *
   * The returned `objectUrl` is created via URL.createObjectURL and must be
   * revoked by the caller when no longer needed (on reset / image change).
   *
   * `imageData.data` (Uint8ClampedArray) is the raw RGBA pixel buffer passed
   * directly to the WASM engine — no intermediate base64 / PNG encoding (C3).
   */
  const loadImage = useCallback((file) => {
    return new Promise((resolve, reject) => {
      // Object URL is cheap (just a browser reference to the file blob).
      // Used for both decode src and original <img> display — no toDataURL (C3).
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        try {
          const canvas = decodeCanvasRef.current;
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve({
            objectUrl,    // caller displays this in <img src> — NO toDataURL
            imageData,    // raw RGBA for WASM
            width: canvas.width,
            height: canvas.height,
          });
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error(`Failed to read pixel data: ${err.message}`));
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not decode image. Try PNG, JPEG, or WebP."));
      };

      img.src = objectUrl;
    });
  }, []);

  return { loadImage };
}

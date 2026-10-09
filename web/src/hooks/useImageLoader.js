import { useRef, useCallback } from "react";

/**
 * Draws an image File/Blob onto an off-screen canvas and returns:
 *   - `imageData` (ImageData)  — raw RGBA pixel data
 *   - `dataUrl`   (string)     — preview-ready data URL
 *   - `width`, `height`        — pixel dimensions
 */
export function useImageLoader() {
  const canvasRef = useRef(null);

  if (!canvasRef.current) {
    canvasRef.current = document.createElement("canvas");
  }

  const loadImage = useCallback((file) => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        URL.revokeObjectURL(url);
        resolve({
          imageData,
          dataUrl,
          width: canvas.width,
          height: canvas.height,
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load image"));
      };
      img.src = url;
    });
  }, []);

  /**
   * Converts a processed Uint8Array back to a data URL via the canvas.
   */
  const toDataUrl = useCallback((uint8Array, width, height) => {
    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const imgData = new ImageData(
      new Uint8ClampedArray(uint8Array.buffer),
      width,
      height
    );
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL("image/png");
  }, []);

  return { loadImage, toDataUrl };
}

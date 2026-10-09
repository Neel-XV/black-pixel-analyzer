/*!
 * pixel-engine — WASM module for Black Pixel Analyzer
 *
 * Exposes two functions to JavaScript via wasm-bindgen:
 *   - `analyze(data, width, height)`  → black pixel percentage (f64)
 *   - `blackify(data, threshold)`     → new Uint8Array with dark pixels set to black
 *
 * The `data` argument follows the standard Canvas ImageData layout:
 * a flat RGBA byte array with 4 bytes per pixel (R, G, B, A).
 *
 * # Why Rust?
 * JavaScript's single-threaded pixel loops are slow for large images.
 * Rust compiled to WASM gives near-native SIMD-friendly iteration,
 * zero GC pauses, and predictable memory usage — all within the browser.
 */

use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/// Returns `true` when all three colour channels are ≤ `threshold`.
#[inline(always)]
fn is_near_black(r: u8, g: u8, b: u8, threshold: u8) -> bool {
    r <= threshold && g <= threshold && b <= threshold
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Calculate the percentage of **pure-black** pixels (R=0, G=0, B=0).
///
/// # Arguments
/// * `data`   – Raw RGBA bytes from `CanvasRenderingContext2D.getImageData`.
/// * `width`  – Image width in pixels.
/// * `height` – Image height in pixels.
///
/// # Returns
/// A value in `[0.0, 100.0]` representing the fraction of black pixels.
#[wasm_bindgen]
pub fn analyze(data: &[u8], width: u32, height: u32) -> f64 {
    let total_pixels = (width as u64) * (height as u64);
    if total_pixels == 0 {
        return 0.0;
    }

    // Count pixels where R == 0 AND G == 0 AND B == 0 (alpha ignored).
    let black_count = data
        .chunks_exact(4)
        .filter(|px| px[0] == 0 && px[1] == 0 && px[2] == 0)
        .count() as u64;

    (black_count as f64 / total_pixels as f64) * 100.0
}

/// Return a **new** RGBA buffer where every pixel with all channels ≤ `threshold`
/// is replaced with pure black (0, 0, 0, 255).  Alpha channel of non-black
/// pixels is preserved unchanged.
///
/// # Arguments
/// * `data`      – Raw RGBA bytes (will not be mutated).
/// * `threshold` – Inclusive upper bound (0–255).  A pixel is blackified when
///                 R ≤ threshold AND G ≤ threshold AND B ≤ threshold.
///
/// # Returns
/// A new `Vec<u8>` (exposed as `Uint8Array` on the JS side) containing the
/// processed image in RGBA format.
#[wasm_bindgen]
pub fn blackify(data: &[u8], threshold: u8) -> Vec<u8> {
    let mut out = data.to_vec();

    for chunk in out.chunks_exact_mut(4) {
        if is_near_black(chunk[0], chunk[1], chunk[2], threshold) {
            chunk[0] = 0;
            chunk[1] = 0;
            chunk[2] = 0;
            chunk[3] = 255; // ensure opaque black
        }
    }

    out
}

/// Like `blackify`, but also returns the resulting black-pixel percentage
/// packed into a two-element array `[processed_rgba_bytes…, percentage]`.
/// This avoids a second round-trip to WASM just to recalculate the stat.
///
/// Prefer `blackify` + `analyze` separately when you already have the buffer.
#[wasm_bindgen]
pub fn blackify_and_analyze(data: &[u8], threshold: u8, width: u32, height: u32) -> js_sys::Array {
    let processed = blackify(data, threshold);
    let pct = analyze(&processed, width, height);

    let result = js_sys::Array::new();
    // Transfer processed bytes as Uint8Array
    let uint8 = js_sys::Uint8Array::from(processed.as_slice());
    result.push(&uint8);
    result.push(&JsValue::from_f64(pct));
    result
}

// ---------------------------------------------------------------------------
// Tests (run with: wasm-pack test --headless --firefox)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_pixel(r: u8, g: u8, b: u8) -> Vec<u8> {
        vec![r, g, b, 255]
    }

    #[test]
    fn all_black_image() {
        let data = make_pixel(0, 0, 0);
        assert_eq!(analyze(&data, 1, 1), 100.0);
    }

    #[test]
    fn all_white_image() {
        let data = make_pixel(255, 255, 255);
        assert_eq!(analyze(&data, 1, 1), 0.0);
    }

    #[test]
    fn half_black() {
        let mut data = make_pixel(0, 0, 0);
        data.extend(make_pixel(255, 255, 255));
        let pct = analyze(&data, 2, 1);
        assert!((pct - 50.0).abs() < f64::EPSILON);
    }

    #[test]
    fn blackify_below_threshold() {
        let data = make_pixel(30, 25, 28); // near-black
        let out = blackify(&data, 32);
        assert_eq!(&out[..4], &[0, 0, 0, 255]);
    }

    #[test]
    fn blackify_above_threshold() {
        let data = make_pixel(100, 80, 90); // not near-black
        let out = blackify(&data, 32);
        assert_eq!(&out[..4], &[100, 80, 90, 255]);
    }

    #[test]
    fn blackify_exact_threshold() {
        let data = make_pixel(32, 32, 32);
        let out = blackify(&data, 32);
        assert_eq!(&out[..4], &[0, 0, 0, 255]);
    }
}

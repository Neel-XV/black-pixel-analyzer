/*!
 * pixel-engine — WASM module for Black Pixel Analyzer
 *
 * Public API (all exported via wasm-bindgen):
 *
 *  One-time per image:
 *   - `max_histogram(data)`          → Uint32Array[256] of max-channel counts (C5)
 *
 *  Per-threshold (hot path):
 *   - `blackify_into(src, dst, t)`   → writes result into caller's buffer, no alloc (C6)
 *
 *  Legacy / utility:
 *   - `analyze(data, w, h)`          → black pixel % (skips alpha=0 pixels) (C12)
 *   - `blackify(data, t)`            → returns new Vec<u8> (used for download fallback)
 *
 * The `data` / `src` arguments follow the Canvas ImageData layout:
 * a flat RGBA byte array with 4 bytes per pixel (R, G, B, A).
 *
 * Performance design:
 *  - `max_histogram` is called ONCE per image; JS derives instant percentage stats
 *    for any threshold via cumulative sum — no per-drag WASM call needed for stats.
 *  - `blackify_into` takes a pre-allocated output slice (no to_vec(), no re-analysis).
 *    JS reuses the same Uint8Array / ImageData across all slider drags.
 *  - Transparent pixels (alpha == 0) are excluded from histogram counts and
 *    blackify treats their RGB channels the same as opaque ones but preserves alpha (C12).
 */

use wasm_bindgen::prelude::*;

// ─── C5: One-time histogram (replaces per-drag stats calculation) ─────────────

/// Build a 256-bin histogram of `max(R, G, B)` for each non-fully-transparent pixel.
///
/// Fully transparent pixels (A == 0) are skipped so they don't inflate the black
/// percentage for PNG/GIF images with transparency (C12).
///
/// # Returns
/// A `Uint32Array` of length 256 where `result[v]` is the count of opaque pixels
/// whose brightest channel equals `v`.
///
/// # Usage in JS
/// ```js
/// const hist = wasm.max_histogram(srcRgba);
/// // Build cumulative: cum[t+1] = number of opaque pixels with max(r,g,b) <= t
/// const cum = new Float64Array(257);
/// let totalOpaque = 0;
/// for (let i = 0; i < 256; i++) { totalOpaque += hist[i]; cum[i+1] = totalOpaque; }
/// const pctAt = t => totalOpaque > 0 ? cum[t+1] / totalOpaque * 100 : 0;
/// ```
#[wasm_bindgen]
pub fn max_histogram(data: &[u8]) -> Vec<u32> {
    let mut h = [0u32; 256];
    for px in data.chunks_exact(4) {
        if px[3] > 0 {
            // max of R, G, B via chained comparisons (branchless-friendly)
            let m = px[0].max(px[1]).max(px[2]);
            h[m as usize] += 1;
        }
    }
    h.to_vec()
}

// ─── C6: Zero-allocation blackify into a caller-provided buffer ───────────────

/// Write the blackified image into `dst` from `src`.
///
/// For every pixel: if R ≤ `threshold` AND G ≤ `threshold` AND B ≤ `threshold`,
/// the output pixel is (0, 0, 0, original_alpha); otherwise the pixel is copied
/// unchanged. Alpha is always preserved (C12).
///
/// # Why no allocation?
/// `dst` is a pre-allocated `Uint8Array` in JS that is reused across every slider
/// drag. Combined with JS reusing the same `ImageData` that wraps `dst`'s buffer,
/// this avoids any allocation in the hot path (C6).
///
/// # Arguments
/// * `src` – original RGBA bytes (read-only)
/// * `dst` – output RGBA buffer of the same length (caller allocates once)
/// * `threshold` – pixels with all channels ≤ this value → black
#[wasm_bindgen]
pub fn blackify_into(src: &[u8], dst: &mut [u8], threshold: u8) {
    for (s, d) in src.chunks_exact(4).zip(dst.chunks_exact_mut(4)) {
        d[3] = s[3]; // always preserve alpha
        if s[0] <= threshold && s[1] <= threshold && s[2] <= threshold {
            d[0] = 0;
            d[1] = 0;
            d[2] = 0;
        } else {
            d[0] = s[0];
            d[1] = s[1];
            d[2] = s[2];
        }
    }
}

// ─── Legacy API (kept for compatibility / non-hot paths) ─────────────────────

/// Calculate the percentage of **pure-black** opaque pixels (R=0, G=0, B=0, A>0).
///
/// Fully transparent pixels are excluded from both the numerator and denominator
/// to avoid inflating the count for transparent PNGs (C12).
///
/// Prefer `max_histogram` + cumulative sum for repeated queries (e.g. during slider drag).
#[wasm_bindgen]
pub fn analyze(data: &[u8], width: u32, height: u32) -> f64 {
    let _ = (width, height); // kept for API compat; not needed for calculation

    let mut total_opaque: u64 = 0;
    let mut black_count: u64 = 0;

    for px in data.chunks_exact(4) {
        if px[3] > 0 {
            total_opaque += 1;
            if px[0] == 0 && px[1] == 0 && px[2] == 0 {
                black_count += 1;
            }
        }
    }

    if total_opaque == 0 {
        return 0.0;
    }
    (black_count as f64 / total_opaque as f64) * 100.0
}

/// Return a **new** RGBA buffer with near-black pixels set to pure black.
///
/// Allocates on every call — use `blackify_into` in the hot path (slider drag).
/// This is retained as a convenient one-shot utility (e.g. server-side or tests).
#[wasm_bindgen]
pub fn blackify(data: &[u8], threshold: u8) -> Vec<u8> {
    let mut out = vec![0u8; data.len()];
    blackify_into(data, &mut out, threshold);
    out
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn px(r: u8, g: u8, b: u8, a: u8) -> [u8; 4] { [r, g, b, a] }
    fn buf(pixels: &[[u8; 4]]) -> Vec<u8> { pixels.iter().flatten().copied().collect() }

    // ── max_histogram ─────────────────────────────────────────────────────────

    #[test]
    fn histogram_pure_black() {
        let data = buf(&[px(0, 0, 0, 255)]);
        let h = max_histogram(&data);
        assert_eq!(h[0], 1);
        assert_eq!(h[1..].iter().sum::<u32>(), 0);
    }

    #[test]
    fn histogram_skips_transparent() {
        // alpha=0 pixel should not appear in histogram
        let data = buf(&[px(0, 0, 0, 0)]);
        let h = max_histogram(&data);
        assert_eq!(h.iter().sum::<u32>(), 0);
    }

    #[test]
    fn histogram_max_channel() {
        // max(50, 80, 30) = 80 → bin 80
        let data = buf(&[px(50, 80, 30, 255)]);
        let h = max_histogram(&data);
        assert_eq!(h[80], 1);
    }

    #[test]
    fn histogram_cumsum_pct() {
        // 1 black + 1 white pixel → 50 % at threshold 0
        let data = buf(&[px(0, 0, 0, 255), px(255, 255, 255, 255)]);
        let h = max_histogram(&data);
        let mut cum = [0u64; 257];
        let mut total: u64 = 0;
        for i in 0..256 { total += h[i] as u64; cum[i + 1] = total; }
        let pct_at_0 = cum[1] as f64 / total as f64 * 100.0;
        assert!((pct_at_0 - 50.0).abs() < f64::EPSILON);
    }

    // ── blackify_into ─────────────────────────────────────────────────────────

    #[test]
    fn blackify_into_below_threshold() {
        let src = buf(&[px(30, 25, 28, 255)]);
        let mut dst = vec![0u8; src.len()];
        blackify_into(&src, &mut dst, 32);
        assert_eq!(&dst, &[0, 0, 0, 255]);
    }

    #[test]
    fn blackify_into_above_threshold() {
        let src = buf(&[px(100, 80, 90, 255)]);
        let mut dst = vec![0u8; src.len()];
        blackify_into(&src, &mut dst, 32);
        assert_eq!(&dst, &[100, 80, 90, 255]);
    }

    #[test]
    fn blackify_into_exact_threshold() {
        let src = buf(&[px(32, 32, 32, 255)]);
        let mut dst = vec![0u8; src.len()];
        blackify_into(&src, &mut dst, 32);
        assert_eq!(&dst, &[0, 0, 0, 255]);
    }

    #[test]
    fn blackify_into_preserves_alpha() {
        let src = buf(&[px(10, 10, 10, 128)]);
        let mut dst = vec![0u8; src.len()];
        blackify_into(&src, &mut dst, 32);
        assert_eq!(dst[3], 128); // alpha preserved
        assert_eq!(&dst[..3], &[0, 0, 0]);
    }

    #[test]
    fn blackify_into_idempotent() {
        // applying twice with same threshold must equal applying once
        let src = buf(&[px(20, 30, 15, 255), px(200, 100, 50, 255)]);
        let mut dst1 = vec![0u8; src.len()];
        blackify_into(&src, &mut dst1, 32);
        let dst1_copy = dst1.clone();
        blackify_into(&dst1_copy, &mut dst1, 32);
        let mut expected = vec![0u8; src.len()];
        blackify_into(&src, &mut expected, 32);
        assert_eq!(dst1, expected);
    }

    #[test]
    fn blackify_into_monotonic() {
        // pct at t+1 >= pct at t for any image
        let src = buf(&[
            px(0, 0, 0, 255), px(32, 32, 32, 255),
            px(64, 64, 64, 255), px(128, 128, 128, 255),
        ]);
        let h = max_histogram(&src);
        let mut cum = [0u64; 257];
        let mut total: u64 = 0;
        for i in 0..256 { total += h[i] as u64; cum[i + 1] = total; }
        for t in 0..255usize {
            assert!(cum[t + 1] <= cum[t + 2], "not monotonic at t={t}");
        }
    }

    // ── analyze (legacy) ─────────────────────────────────────────────────────

    #[test]
    fn analyze_skips_transparent() {
        let data = buf(&[px(0, 0, 0, 0), px(255, 255, 255, 255)]);
        let pct = analyze(&data, 2, 1);
        assert_eq!(pct, 0.0); // only white opaque pixel counted
    }

    #[test]
    fn analyze_all_black_opaque() {
        let data = buf(&[px(0, 0, 0, 255)]);
        assert_eq!(analyze(&data, 1, 1), 100.0);
    }
}

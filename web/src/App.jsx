/**
 * App.jsx — Black Pixel Analyzer
 *
 * Performance architecture (implements C1–C4, C7, C11, C13, B2, B3):
 *
 *  Original image   → <img src={objectUrl}>  (URL.createObjectURL — no encode)  (C3)
 *  Preview          → <canvas ref>           (putImageData — no encode)          (C1)
 *  Stats            → histogram cumsum       (instant, no WASM call per drag)    (C5)
 *  Slider hot path  → rAF-throttled          (at most 1 update per frame)        (C7)
 *  Stale work       → request-id guard       (only latest result painted)        (B3)
 *  Download         → canvas.toBlob()        (PNG encode only on click)          (C2)
 *  React state      → minimal (no pixel bufs in state)                           (B2)
 */

import { useState, useCallback, useRef, useEffect, memo } from "react";
import { useWasm } from "./hooks/useWasm";
import { useImageLoader } from "./hooks/useImageLoader";
import { usePixelEngine } from "./hooks/usePixelEngine";
import "./App.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: "Off",    value: 0,   tip: "No change — analyze only" },
  { label: "Subtle", value: 16,  tip: "Very dark pixels only" },
  { label: "Light",  value: 32,  tip: "Near-black (default)" },
  { label: "Medium", value: 64,  tip: "Dark grays" },
  { label: "Strong", value: 96,  tip: "Mid-dark grays" },
  { label: "Heavy",  value: 128, tip: "Half the value range" },
];

const DEFAULT_THRESHOLD = 32;

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { wasm, loading: wasmLoading, error: wasmError } = useWasm();
  const { loadImage } = useImageLoader();
  const engine = usePixelEngine(wasm);

  // ── Refs: nothing here triggers a re-render ──────────────────────────────
  const previewCanvasRef = useRef(null); // visible preview <canvas>
  const srcDataRef       = useRef(null); // Uint8ClampedArray — original pixels
  const objectUrlRef     = useRef(null); // revocable URL for original <img>
  const rafRef           = useRef(null); // current rAF handle
  const reqIdRef         = useRef(0);    // stale-work cancellation counter (B3)

  // ── React state: only UI-visible data, never pixel buffers ──────────────
  const [hasImage,      setHasImage]      = useState(false);
  const [fileName,      setFileName]      = useState("");
  const [dims,          setDims]          = useState({ width: 0, height: 0 });
  const [origUrl,       setOrigUrl]       = useState(null);   // object URL for <img>
  const [threshold,     setThreshold]     = useState(DEFAULT_THRESHOLD);
  const [originalPct,   setOriginalPct]   = useState(null);
  const [processedPct,  setProcessedPct]  = useState(null);
  const [dragging,      setDragging]      = useState(false);
  const [error,         setError]         = useState(null);
  const [downloading,   setDownloading]   = useState(false);
  const [showSideBySide,setShowSideBySide]= useState(false);

  // ── Core: apply threshold to preview canvas (no React state touched) ─────
  // Called from rAF — runs WASM blackify_into + putImageData directly.
  const applyThreshold = useCallback(
    (thresh, reqId) => {
      if (reqId !== reqIdRef.current) return; // stale — discard (B3)
      const canvas = previewCanvasRef.current;
      if (!canvas || !srcDataRef.current) return;
      const ctx = canvas.getContext("2d");
      engine.applyToCanvas(srcDataRef.current, ctx, thresh);
      // Update the processed % stat (instant from histogram)
      setProcessedPct(engine.pctAt(thresh));
    },
    [engine]
  );

  // ── Schedule an rAF-throttled preview update (C7) ────────────────────────
  const scheduleUpdate = useCallback(
    (thresh) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const reqId = ++reqIdRef.current;
      rafRef.current = requestAnimationFrame(() => {
        applyThreshold(thresh, reqId);
        rafRef.current = null;
      });
    },
    [applyThreshold]
  );

  // ── Threshold change handler (slider + preset pills) ──────────────────────
  const handleThresholdChange = useCallback(
    (value) => {
      setThreshold(value);
      if (srcDataRef.current) scheduleUpdate(value);
    },
    [scheduleUpdate]
  );

  // ── Load a new image file ─────────────────────────────────────────────────
  const handleFile = useCallback(
    async (file) => {
      if (!wasm || !file) return;
      setError(null);

      try {
        // Revoke previous object URL to free memory (C13)
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
        // Cancel any pending rAF
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }

        // Decode: returns objectUrl (for <img>) + raw ImageData (for WASM)
        const { objectUrl, imageData, width, height } = await loadImage(file);

        // Store for hot path (C1 — no copy into React state)
        objectUrlRef.current = objectUrl;
        srcDataRef.current   = imageData.data;

        // Initialise histogram + output buffer (C5, C6 — once per image)
        engine.initImage(imageData.data, width, height);

        // Size the preview canvas to match image (no CSS distortion)
        const canvas = previewCanvasRef.current;
        if (canvas) {
          canvas.width  = width;
          canvas.height = height;
        }

        // Original black pixel % = histogram bin 0 / total opaque (instant)
        const origPct = engine.pctAt(0);

        // Apply initial threshold (C4: only one call — effect removed) (C4)
        const initReqId = ++reqIdRef.current;
        requestAnimationFrame(() => applyThreshold(DEFAULT_THRESHOLD, initReqId));

        // Update React state (display-only values)
        setOrigUrl(objectUrl);
        setFileName(file.name);
        setDims({ width, height });
        setThreshold(DEFAULT_THRESHOLD);
        setOriginalPct(origPct);
        setProcessedPct(engine.pctAt(DEFAULT_THRESHOLD));
        setHasImage(true);
        setShowSideBySide(false);
      } catch (err) {
        setError(err.message); // C13: user-visible error
      }
    },
    [wasm, loadImage, engine, applyThreshold]
  );

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current); // free memory
      objectUrlRef.current = null;
    }
    srcDataRef.current = null;
    engine.reset();

    setHasImage(false);
    setFileName("");
    setDims({ width: 0, height: 0 });
    setOrigUrl(null);
    setThreshold(DEFAULT_THRESHOLD);
    setOriginalPct(null);
    setProcessedPct(null);
    setError(null);
    setDownloading(false);
    setShowSideBySide(false);
  }, [engine]);

  // ── Download: PNG encode only on click (C2) ────────────────────────────────
  const handleDownload = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    setDownloading(true);
    // toBlob runs async PNG compression without blocking the UI (C2)
    canvas.toBlob((blob) => {
      if (!blob) { setDownloading(false); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `blackified_t${threshold}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000); // revoke after save dialog
      setDownloading(false);
    }, "image/png");
  }, [threshold]);

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  // ── Computed display values ────────────────────────────────────────────────
  const gain = processedPct !== null && originalPct !== null
    ? processedPct - originalPct
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-icon" aria-hidden>◼</span>
          <span className="brand-name">Black Pixel Analyzer</span>
          <span className="brand-sub">for AMOLED</span>
        </div>
        <div className="topbar-right">
          <WasmPill loading={wasmLoading} error={wasmError} />
          {hasImage && (
            <button className="btn-reset" onClick={handleReset} title="Start over">
              ✕ Reset
            </button>
          )}
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="error-banner" role="alert">
          ⚠ {error}
          <button onClick={() => setError(null)} className="error-dismiss">✕</button>
        </div>
      )}

      {/* Drop zone (shown when no image loaded) */}
      {!hasImage ? (
        <section
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            id="file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
            onChange={onFileInput}
            style={{ display: "none" }}
          />
          <label htmlFor="file-input" className="dropzone-label">
            <span className="dz-icon">🖼️</span>
            <span className="dz-primary">
              {wasmLoading ? "Loading engine…" : "Drop an image here"}
            </span>
            <span className="dz-secondary">
              or <u>click to browse</u> — PNG, JPEG, WebP, BMP
            </span>
          </label>
        </section>
      ) : (

        /* Workspace */
        <div className="workspace">

          {/* File info bar */}
          <div className="file-bar">
            <span className="file-name">📄 {fileName}</span>
            <span className="file-dims">{dims.width} × {dims.height} px</span>
            <label htmlFor="file-input-ws" className="btn-ghost">Change image</label>
            <input
              id="file-input-ws"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
              onChange={onFileInput}
              style={{ display: "none" }}
            />
          </div>

          {/* Stats row */}
          <div className="stats-row">
            <StatCard
              icon="◻" label="Original black pixels" color="muted"
              value={originalPct !== null ? `${originalPct.toFixed(2)}%` : "—"}
            />
            <span className="stats-arrow" aria-hidden>→</span>
            <StatCard
              icon="◼" label="After blackify" color="accent"
              value={processedPct !== null ? `${processedPct.toFixed(2)}%` : "—"}
            />
            {gain !== null && gain > 0.005 && (
              <>
                <span className="stats-arrow" aria-hidden>+</span>
                <StatCard
                  icon="⚡" label="AMOLED power gain" color="green"
                  value={`+${gain.toFixed(2)}%`}
                />
              </>
            )}
          </div>

          {/* Threshold control card */}
          <div className="control-card">
            <div className="control-header">
              <div>
                <h2 className="control-title">Blackify Threshold</h2>
                <p className="control-desc">
                  Pixels where R, G, B ≤ <strong>{threshold}</strong> → pure black
                </p>
              </div>
              <div className="threshold-badge">{threshold}</div>
            </div>

            {/* Preset pills */}
            <div className="presets" role="group" aria-label="Threshold presets">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  className={`preset-pill ${threshold === p.value ? "active" : ""}`}
                  onClick={() => handleThresholdChange(p.value)}
                  title={p.tip}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Slider with gradient fill and tick marks */}
            <div className="slider-wrap">
              <span className="slider-edge">0</span>
              <div className="slider-track-wrap">
                <input
                  type="range"
                  min={0} max={255} step={1}
                  value={threshold}
                  onChange={(e) => handleThresholdChange(Number(e.target.value))}
                  className="slider"
                  style={{ "--pct": `${(threshold / 255) * 100}%` }}
                  aria-label="Blackify threshold"
                />
                <div className="slider-ticks" aria-hidden>
                  {PRESETS.filter((p) => p.value > 0).map((p) => (
                    <span
                      key={p.value}
                      className={`tick ${threshold >= p.value ? "tick-passed" : ""}`}
                      style={{ left: `${(p.value / 255) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
              <span className="slider-edge">255</span>
            </div>
          </div>

          {/* Image preview section */}
          <div className="image-section">
            <div className="image-section-header">
              <h2 className="section-title">Preview</h2>
              <button
                className={`btn-ghost ${showSideBySide ? "active" : ""}`}
                onClick={() => setShowSideBySide((v) => !v)}
              >
                {showSideBySide ? "Single view" : "Side by side"}
              </button>
            </div>

            <div className={`image-row ${showSideBySide ? "row-split" : "row-single"}`}>
              {/* Original: just an <img> with object URL — zero encoding cost (C3) */}
              {showSideBySide && (
                <figure className="image-card">
                  <div className="image-wrap">
                    <img src={origUrl} alt="Original" />
                    {originalPct !== null && (
                      <span className="image-badge">{originalPct.toFixed(1)}% black</span>
                    )}
                  </div>
                  <figcaption>Original</figcaption>
                </figure>
              )}

              {/* Preview: <canvas> painted via putImageData — no PNG encode (C1) */}
              <figure className={`image-card ${showSideBySide ? "" : "image-wide"} image-accent`}>
                <div className="image-wrap">
                  <canvas
                    ref={previewCanvasRef}
                    className="preview-canvas"
                    aria-label="Blackified preview"
                  />
                  {processedPct !== null && (
                    <span className="image-badge accent-badge">
                      {processedPct.toFixed(1)}% black
                    </span>
                  )}
                </div>
                <figcaption>Blackified (threshold {threshold})</figcaption>
              </figure>
            </div>
          </div>

          {/* Action bar */}
          <div className="action-bar">
            <button className="btn-ghost" onClick={handleReset}>✕ Reset &amp; start over</button>
            <button
              className="btn-download"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? "⏳ Preparing…" : "⬇ Download blackified image"}
            </button>
          </div>
        </div>
      )}

      <footer className="footer">
        Runs 100% in your browser — no uploads, no server · Powered by Rust + WebAssembly
      </footer>
    </div>
  );
}

// ─── Memoised sub-components (B2) ────────────────────────────────────────────

const WasmPill = memo(function WasmPill({ loading, error }) {
  if (loading) return <span className="wasm-pill loading">⏳ Loading engine…</span>;
  if (error)   return <span className="wasm-pill error" title={error.message}>⚠ WASM error</span>;
  return <span className="wasm-pill ready">⚙ WASM ready</span>;
});

const StatCard = memo(function StatCard({ icon, label, value, color }) {
  return (
    <div className={`stat-card stat-${color}`}>
      <span className="stat-icon" aria-hidden>{icon}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
});

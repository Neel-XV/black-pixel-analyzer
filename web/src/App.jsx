import { useState, useCallback, useRef, useEffect } from "react";
import { useWasm } from "./hooks/useWasm";
import { useImageLoader } from "./hooks/useImageLoader";
import "./App.css";

// ─── Debounce helper ─────────────────────────────────────────────────────────
function useDebounce(fn, delay) {
  const timer = useRef(null);
  return useCallback(
    (...args) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay]
  );
}

// ─── Preset thresholds ───────────────────────────────────────────────────────
const PRESETS = [
  { label: "Off",    value: 0,   tip: "No change" },
  { label: "Subtle", value: 16,  tip: "Very dark pixels only" },
  { label: "Light",  value: 32,  tip: "Near-black (default)" },
  { label: "Medium", value: 64,  tip: "Dark grays" },
  { label: "Strong", value: 96,  tip: "Mid-dark grays" },
  { label: "Heavy",  value: 128, tip: "Half-range" },
];

const DEFAULT_THRESHOLD = 32;

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { wasm, loading: wasmLoading, error: wasmError } = useWasm();
  const { loadImage, toDataUrl } = useImageLoader();

  // Image state
  const [originalDataUrl, setOriginalDataUrl] = useState(null);
  const [processedDataUrl, setProcessedDataUrl] = useState(null);
  const [imageData, setImageData] = useState(null);
  const [imageDims, setImageDims] = useState({ width: 0, height: 0 });
  const [fileName, setFileName] = useState("");

  // Analysis state
  const [originalPct, setOriginalPct] = useState(null);
  const [processedPct, setProcessedPct] = useState(null);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);

  // UI state
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [showComparison, setShowComparison] = useState(false);

  // ── Process image with WASM ─────────────────────────────────────────────
  const processWithWasm = useCallback(
    async (rawData, width, height, thresh) => {
      if (!wasm || !rawData) return;
      setProcessing(true);
      try {
        const result = wasm.blackify_and_analyze(rawData, thresh, width, height);
        const processedBytes = result[0];
        const pct = result[1];
        const url = toDataUrl(processedBytes, width, height);
        setProcessedDataUrl(url);
        setProcessedPct(pct);
        setDownloadUrl(url);
      } finally {
        setProcessing(false);
      }
    },
    [wasm, toDataUrl]
  );

  const debouncedProcess = useDebounce(processWithWasm, 80);

  useEffect(() => {
    if (imageData) {
      debouncedProcess(imageData, imageDims.width, imageDims.height, threshold);
    }
  }, [threshold, imageData, imageDims, debouncedProcess]);

  // ── File loading ────────────────────────────────────────────────────────
  const handleFile = useCallback(
    async (file) => {
      if (!file || !wasm) return;
      const { imageData: imgData, dataUrl, width, height } = await loadImage(file);
      const rawData = imgData.data;
      const pct = wasm.analyze(rawData, width, height);

      setOriginalDataUrl(dataUrl);
      setOriginalPct(pct);
      setImageData(rawData);
      setImageDims({ width, height });
      setFileName(file.name);
      setProcessedDataUrl(null);
      setProcessedPct(null);
      setDownloadUrl(null);
      setThreshold(DEFAULT_THRESHOLD);
      setShowComparison(false);
      processWithWasm(rawData, width, height, DEFAULT_THRESHOLD);
    },
    [wasm, loadImage, processWithWasm]
  );

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setOriginalDataUrl(null);
    setProcessedDataUrl(null);
    setImageData(null);
    setImageDims({ width: 0, height: 0 });
    setFileName("");
    setOriginalPct(null);
    setProcessedPct(null);
    setThreshold(DEFAULT_THRESHOLD);
    setDownloadUrl(null);
    setProcessing(false);
    setShowComparison(false);
  };

  const onFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const gain = processedPct !== null && originalPct !== null
    ? (processedPct - originalPct).toFixed(1)
    : null;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-icon" aria-hidden>◼</span>
          <span className="brand-name">Black Pixel Analyzer</span>
          <span className="brand-sub">for AMOLED</span>
        </div>
        <div className="topbar-right">
          <WasmPill loading={wasmLoading} error={wasmError} />
          {originalDataUrl && (
            <button className="btn-reset" onClick={handleReset} title="Start over">
              ✕ Reset
            </button>
          )}
        </div>
      </header>

      {/* ── Drop zone ────────────────────────────────────────────────── */}
      {!originalDataUrl ? (
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
            <span className="dz-primary">Drop an image here</span>
            <span className="dz-secondary">or <u>click to browse</u> — PNG, JPEG, WebP, BMP</span>
          </label>
        </section>
      ) : (
        /* ── Main workspace ──────────────────────────────────────────── */
        <div className="workspace">

          {/* ── File info bar ─────────────────────────────────────────── */}
          <div className="file-bar">
            <span className="file-name">📄 {fileName}</span>
            <span className="file-dims">{imageDims.width} × {imageDims.height}px</span>
            <label htmlFor="file-input" className="btn-ghost">
              Change image
            </label>
            <input
              id="file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
              onChange={onFileInput}
              style={{ display: "none" }}
            />
          </div>

          {/* ── Stats row ─────────────────────────────────────────────── */}
          <div className="stats-row">
            <StatCard
              icon="◻"
              label="Original black pixels"
              value={originalPct !== null ? `${originalPct.toFixed(2)}%` : "—"}
              color="muted"
            />
            <div className="stats-arrow">→</div>
            <StatCard
              icon="◼"
              label="After blackify"
              value={processedPct !== null ? `${processedPct.toFixed(2)}%` : "—"}
              color="accent"
              loading={processing}
            />
            {gain !== null && Number(gain) > 0 && (
              <>
                <div className="stats-arrow">+</div>
                <StatCard
                  icon="⚡"
                  label="AMOLED power gain"
                  value={`+${gain}%`}
                  color="green"
                />
              </>
            )}
          </div>

          {/* ── Threshold control ─────────────────────────────────────── */}
          <div className="control-card">
            <div className="control-header">
              <div>
                <h2 className="control-title">Blackify Threshold</h2>
                <p className="control-desc">
                  Pixels where R, G, B are all ≤ <strong>{threshold}</strong> will become pure black
                </p>
              </div>
              <div className="threshold-badge">{threshold}</div>
            </div>

            {/* Preset pills */}
            <div className="presets">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  className={`preset-pill ${threshold === p.value ? "active" : ""}`}
                  onClick={() => setThreshold(p.value)}
                  title={p.tip}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Slider */}
            <div className="slider-wrap">
              <span className="slider-edge">0</span>
              <div className="slider-track-wrap">
                <input
                  type="range"
                  min={0}
                  max={255}
                  step={1}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="slider"
                  style={{ "--pct": `${(threshold / 255) * 100}%` }}
                />
                {/* Tick marks at preset positions */}
                <div className="slider-ticks" aria-hidden>
                  {PRESETS.filter(p => p.value > 0).map((p) => (
                    <span
                      key={p.value}
                      className="tick"
                      style={{ left: `${(p.value / 255) * 100}%` }}
                      title={p.label}
                    />
                  ))}
                </div>
              </div>
              <span className="slider-edge">255</span>
            </div>

            {processing && (
              <div className="processing-row">
                <span className="spinner" />
                <span>Processing…</span>
              </div>
            )}
          </div>

          {/* ── Image comparison ─────────────────────────────────────── */}
          <div className="image-section">
            <div className="image-section-header">
              <h2 className="section-title">Preview</h2>
              <button
                className={`btn-ghost toggle-compare ${showComparison ? "active" : ""}`}
                onClick={() => setShowComparison((v) => !v)}
              >
                {showComparison ? "Single view" : "Side by side"}
              </button>
            </div>

            {showComparison ? (
              <div className="image-row">
                <ImageCard label="Original" src={originalDataUrl} badge={`${originalPct?.toFixed(1)}% black`} />
                {processedDataUrl && (
                  <ImageCard
                    label={`Blackified (t=${threshold})`}
                    src={processedDataUrl}
                    badge={`${processedPct?.toFixed(1)}% black`}
                    accent
                  />
                )}
              </div>
            ) : (
              <div className="image-single">
                {processedDataUrl ? (
                  <ImageCard
                    label={`Blackified (threshold ${threshold})`}
                    src={processedDataUrl}
                    badge={`${processedPct?.toFixed(1)}% black`}
                    accent
                    wide
                  />
                ) : (
                  <ImageCard label="Original" src={originalDataUrl} badge={`${originalPct?.toFixed(1)}% black`} wide />
                )}
              </div>
            )}
          </div>

          {/* ── Action bar ───────────────────────────────────────────── */}
          {downloadUrl && (
            <div className="action-bar">
              <button className="btn-ghost" onClick={handleReset}>
                ✕ Reset & start over
              </button>
              <a href={downloadUrl} download="blackified.png" className="btn-download">
                ⬇ Download blackified image
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="footer">
        Runs 100% in your browser — no uploads, no server · Powered by Rust + WebAssembly
      </footer>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WasmPill({ loading, error }) {
  if (loading) return <span className="wasm-pill loading">⏳ Loading engine…</span>;
  if (error)   return <span className="wasm-pill error">⚠ WASM error</span>;
  return <span className="wasm-pill ready">⚙ WASM ready</span>;
}

function StatCard({ icon, label, value, color, loading }) {
  return (
    <div className={`stat-card stat-${color}`}>
      <span className="stat-icon" aria-hidden>{icon}</span>
      <span className={`stat-value ${loading ? "stat-loading" : ""}`}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function ImageCard({ label, src, badge, accent, wide }) {
  return (
    <figure className={`image-card ${accent ? "image-accent" : ""} ${wide ? "image-wide" : ""}`}>
      <div className="image-wrap">
        <img src={src} alt={label} />
        {badge && <span className="image-badge">{badge}</span>}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

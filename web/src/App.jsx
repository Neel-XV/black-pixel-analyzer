import { useState, useCallback, useRef, useEffect } from "react";
import { useWasm } from "./hooks/useWasm";
import { useImageLoader } from "./hooks/useImageLoader";
import "./App.css";

// ─── Debounce helper ────────────────────────────────────────────────────────
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

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const { wasm, loading: wasmLoading, error: wasmError } = useWasm();
  const { loadImage, toDataUrl } = useImageLoader();

  // Image state
  const [originalDataUrl, setOriginalDataUrl] = useState(null);
  const [processedDataUrl, setProcessedDataUrl] = useState(null);
  const [imageData, setImageData] = useState(null); // raw RGBA Uint8Array
  const [imageDims, setImageDims] = useState({ width: 0, height: 0 });

  // Analysis state
  const [originalPct, setOriginalPct] = useState(null);
  const [processedPct, setProcessedPct] = useState(null);
  const [threshold, setThreshold] = useState(32);

  // UI state
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState("analyze"); // "analyze" | "blackify"
  const [downloadUrl, setDownloadUrl] = useState(null);

  // ── Process image with WASM ──────────────────────────────────────────────
  const processWithWasm = useCallback(
    async (rawData, width, height, thresh) => {
      if (!wasm || !rawData) return;
      setProcessing(true);
      try {
        // WASM call: blackify + analyze in one round-trip
        const result = wasm.blackify_and_analyze(rawData, thresh, width, height);
        const processedBytes = result[0]; // Uint8Array
        const pct = result[1]; // f64

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

  // Re-process whenever threshold changes
  useEffect(() => {
    if (imageData) {
      debouncedProcess(imageData, imageDims.width, imageDims.height, threshold);
    }
  }, [threshold, imageData, imageDims, debouncedProcess]);

  // ── File loading ─────────────────────────────────────────────────────────
  const handleFile = useCallback(
    async (file) => {
      if (!file || !wasm) return;
      const { imageData: imgData, dataUrl, width, height } = await loadImage(file);

      const rawData = imgData.data; // Uint8ClampedArray

      // Analyze original black pixel %
      const pct = wasm.analyze(rawData, width, height);

      setOriginalDataUrl(dataUrl);
      setOriginalPct(pct);
      setImageData(rawData);
      setImageDims({ width, height });
      setProcessedDataUrl(null);
      setProcessedPct(null);
      setDownloadUrl(null);

      // Trigger initial blackify
      processWithWasm(rawData, width, height, threshold);
    },
    [wasm, loadImage, threshold, processWithWasm]
  );

  const onFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="header">
        <h1>
          <span className="icon">◼</span> Black Pixel Analyzer
        </h1>
        <p className="subtitle">
          AMOLED screen optimizer — powered by Rust ⚙️ WebAssembly
        </p>
        {wasmLoading && <span className="badge loading">Loading WASM…</span>}
        {wasmError && (
          <span className="badge error">WASM failed: {wasmError.message}</span>
        )}
        {!wasmLoading && !wasmError && (
          <span className="badge ready">WASM ready</span>
        )}
      </header>

      {/* ── Drop zone ──────────────────────────────────────────────────── */}
      <section
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
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
          {originalDataUrl ? (
            <span>📂 Drop another image or click to change</span>
          ) : (
            <span>📂 Drop an image here, or click to select</span>
          )}
        </label>
      </section>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      {originalDataUrl && (
        <>
          <nav className="tabs">
            <button
              className={tab === "analyze" ? "active" : ""}
              onClick={() => setTab("analyze")}
            >
              📊 Analyze
            </button>
            <button
              className={tab === "blackify" ? "active" : ""}
              onClick={() => setTab("blackify")}
            >
              🎨 Blackify
            </button>
          </nav>

          {/* ── Analyze tab ──────────────────────────────────────────── */}
          {tab === "analyze" && (
            <section className="panel">
              <div className="stat-grid">
                <StatCard
                  label="Original black pixels"
                  value={
                    originalPct !== null ? `${originalPct.toFixed(2)}%` : "—"
                  }
                />
                <StatCard
                  label={`After blackify (threshold ${threshold})`}
                  value={
                    processedPct !== null ? `${processedPct.toFixed(2)}%` : "—"
                  }
                  highlight
                />
              </div>
              <div className="image-row">
                <ImageCard label="Original" src={originalDataUrl} />
                {processedDataUrl && (
                  <ImageCard label="Processed" src={processedDataUrl} />
                )}
              </div>
            </section>
          )}

          {/* ── Blackify tab ─────────────────────────────────────────── */}
          {tab === "blackify" && (
            <section className="panel">
              <div className="threshold-control">
                <label htmlFor="threshold-slider">
                  Threshold:{" "}
                  <strong>{threshold}</strong>
                  <span className="hint">
                    &nbsp;— pixels with R, G, B ≤ {threshold} → pure black
                  </span>
                </label>
                <input
                  id="threshold-slider"
                  type="range"
                  min={0}
                  max={255}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="slider"
                />
              </div>

              {processing && (
                <p className="processing-msg">⚙️ Processing with WASM…</p>
              )}

              <div className="stat-grid">
                <StatCard
                  label="Original black pixels"
                  value={
                    originalPct !== null ? `${originalPct.toFixed(2)}%` : "—"
                  }
                />
                <StatCard
                  label="After blackify"
                  value={
                    processedPct !== null ? `${processedPct.toFixed(2)}%` : "—"
                  }
                  highlight
                />
              </div>

              <div className="image-row">
                <ImageCard label="Original" src={originalDataUrl} />
                {processedDataUrl && (
                  <ImageCard label={`Blackified (t=${threshold})`} src={processedDataUrl} />
                )}
              </div>

              {downloadUrl && (
                <div className="download-row">
                  <a
                    href={downloadUrl}
                    download="blackified.png"
                    className="btn-download"
                  >
                    ⬇️ Download processed image
                  </a>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, highlight }) {
  return (
    <div className={`stat-card ${highlight ? "highlight" : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function ImageCard({ label, src }) {
  return (
    <figure className="image-card">
      <img src={src} alt={label} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, Camera, Check, ChevronDown, CircleAlert, Clock3, CloudUpload, Crosshair, Download, Eye, FileImage, Gauge, Layers3, Lightbulb, LoaderCircle, ScanLine, ShieldCheck, Sparkles, Video, X } from "lucide-react";
import type { AuditEntry, InspectionResult } from "@/lib/types";

type Preset = { name: string; note: string; image: string; result: InspectionResult };
const svg = (background: string, detail: string) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><defs><pattern id="w" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M0 0h14v1H0zm0 0v14h1V0z" fill="${detail}" opacity=".32"/><path d="M7 0v14M0 7h14" stroke="${detail}" stroke-width=".5" opacity=".15"/></pattern><linearGradient id="g" x2="1" y2="1"><stop stop-color="${background}"/><stop offset="1" stop-color="${detail}" stop-opacity=".45"/></linearGradient></defs><rect width="900" height="600" fill="url(#g)"/><rect width="900" height="600" fill="url(#w)"/>${background === "#334155" ? '<ellipse cx="665" cy="205" rx="120" ry="68" fill="#151a20" opacity=".72"/><path d="M0 420l200-32 120 46 180-22" stroke="#131a20" stroke-width="9" opacity=".75"/>' : ""}${background === "#8b9a78" ? '<path d="M380 170l78 62-36 70 81 58-68 57-38-59-77-27 44-72z" fill="#24332b"/><path d="M392 192l39 41-21 56 57 39" fill="none" stroke="#cfdbbd" stroke-width="5" opacity=".6"/>' : ""}</svg>`)}`;
const presets: Preset[] = [
  { name: "Clean Cotton", note: "Premium cotton · Lot CT-2048", image: svg("#a0ad8b", "#d0d8bf"), result: { fabric_quality: "PASS", overall_score: 98, summary: "The fabric surface appears consistent with an even weave and uniform color. No meaningful defects were identified in the inspected area.", defects: [] } },
  { name: "Stained Denim", note: "Indigo denim · Lot DN-7712", image: svg("#334155", "#71849a"), result: { fabric_quality: "WARNING", overall_score: 76, summary: "The denim shows a localized dark stain near the upper-right area. The remaining weave appears structurally sound; review the affected panel before cutting.", defects: [{ id: "def-1", type: "Oil Stain", severity: "MEDIUM", location_description: "Upper-right quadrant, near the selvedge", confidence: 0.94, recommendation: "Isolate the panel and test a spot clean before cutting." }] } },
  { name: "Torn Weave", note: "Canvas weave · Lot CV-3910", image: svg("#8b9a78", "#c5d0b0"), result: { fabric_quality: "FAIL", overall_score: 42, summary: "A pronounced disruption in the weave is visible near the center of the inspected area. The structural defect may affect garment durability and should be isolated.", defects: [{ id: "def-1", type: "Torn Weave", severity: "CRITICAL", location_description: "Center panel, approximately 40% from the left edge", confidence: 0.97, recommendation: "Quarantine this section and inspect adjacent roll length for continued damage." }] } },
];

const badgeClasses: Record<string, string> = { PASS: "status-pass", WARNING: "status-warning", FAIL: "status-fail" };
const severityClasses: Record<string, string> = { CRITICAL: "severity-critical", MEDIUM: "severity-medium", LOW: "severity-low" };

async function normalizeImageForInspection(file: File) {
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("Could not prepare this image for inspection."); }
  // Use a white background so transparent PNG pixels stay visually predictable.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not encode the image for inspection.")), "image/jpeg", 0.85);
  });
  const name = `${file.name.replace(/\.[^.]+$/, "") || "fabric-sample"}.jpg`;
  return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
}

export default function Home() {
  const [selected, setSelected] = useState<Preset>(presets[0]);
  const [image, setImage] = useState(presets[0].image);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<InspectionResult>(presets[0].result);
  const [isDemo, setIsDemo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => { try { setHistory(JSON.parse(localStorage.getItem("zarea-audits") || "[]")); } catch { setHistory([]); } }, []);
  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);
  useEffect(() => {
    if (!cameraOn || !streamRef.current || !videoRef.current) return;
    const video = videoRef.current;
    let disposed = false;
    const markReady = () => {
      if (!disposed && video.videoWidth > 0 && video.videoHeight > 0) setCameraReady(true);
    };
    video.srcObject = streamRef.current;
    video.addEventListener("loadedmetadata", markReady);
    video.addEventListener("canplay", markReady);
    video.play().then(markReady).catch(() => {
      if (!disposed) setError("The camera opened but its preview could not start. Check your browser camera permissions and try again.");
    });
    return () => {
      disposed = true;
      video.removeEventListener("loadedmetadata", markReady);
      video.removeEventListener("canplay", markReady);
    };
  }, [cameraOn]);

  function chooseFile(nextFile?: File) {
    if (!nextFile) return;
    if (!nextFile.type.startsWith("image/")) { setError("Choose a JPG, PNG, WebP, or other image file."); return; }
    if (nextFile.size > 12 * 1024 * 1024) { setError("Images must be smaller than 12 MB."); return; }
    setError(""); setFile(nextFile); setImage(URL.createObjectURL(nextFile)); setIsDemo(false); setResult(null as unknown as InspectionResult);
  }

  function choosePreset(preset: Preset) {
    setSelected(preset); setImage(preset.image); setFile(null); setResult(preset.result); setIsDemo(true); setError("");
  }

  async function runInspection() {
    setError("");
    if (isDemo && !file) { setResult(selected.result); return; }
    if (!file) { setError("Choose an image or select a demo sample first."); return; }
    setLoading(true);
    try {
      const preparedImage = await normalizeImageForInspection(file);
      const form = new FormData(); form.append("image", preparedImage);
      const response = await fetch("/api/inspect", { method: "POST", body: form, signal: AbortSignal.timeout(65_000) });
      // Vercel returns plain text/HTML (not JSON) on platform timeouts, so don't assume JSON.
      const raw = await response.text();
      let payload: any = null;
      try { payload = JSON.parse(raw); } catch {}
      if (!response.ok || !payload) throw new Error(payload?.error || (response.status === 504 ? "The inspection timed out. Please retry." : "Inspection could not be completed. Please retry."));
      setResult(payload);
      const entry: AuditEntry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), fabric_quality: payload.fabric_quality, defects: payload.defects.length, imageName: file.name };
      const next = [entry, ...history].slice(0, 8); setHistory(next); localStorage.setItem("zarea-audits", JSON.stringify(next));
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong. Please try again."); }
    finally { setLoading(false); }
  }

  async function toggleCamera() {
    if (cameraOn) { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setCameraReady(false); setCameraOn(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream; setCameraReady(false); setCameraOn(true); setError("");
    } catch { setError("Camera access is unavailable. Check browser permissions or upload an image instead."); }
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) { setError("The camera is still starting. Wait for the preview, then capture again."); return; }
    const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) { setError("Could not access the camera frame. Try again or upload a photo instead."); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) { setError("The camera frame could not be saved. Please try again."); return; }
      chooseFile(new File([blob], `fabric-capture-${Date.now()}.jpg`, { type: "image/jpeg" }));
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null; setCameraReady(false); setCameraOn(false);
    }, "image/jpeg", 0.92);
  }

  const status = result?.fabric_quality || "PASS";
  const score = result?.overall_score ?? 0;
  const defects = result?.defects || [];

  return (
    <main className="min-h-screen bg-[#0b1110] text-[#f2f5ee]">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Layers3 size={19} /></div><div><div className="brand-name">zarea<span> / </span>qa studio</div><div className="brand-caption">TEXTILE INTELLIGENCE PLATFORM</div></div></div>
        <div className="topbar-right"><div className="system-state"><span className="live-dot" /> SYSTEM ONLINE</div><div className="topbar-divider"/><div className="model-tag"><Sparkles size={13}/> Powered by Gemma 4</div><button className="avatar" aria-label="User profile">H</button></div>
      </header>
      <div className="page-shell">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>QUALITY CONTROL <span className="eyebrow-slash">/</span> INSPECTION STATION</div><h1>Fabric inspection<span className="title-period">.</span></h1><p className="page-subtitle">Computer vision quality assurance for every yard, every roll.</p></div><div className="station-chip"><ScanLine size={16}/><span>STATION 04</span><span className="chip-separator">·</span><span>LINE A</span></div></div>

        <section className="workspace-grid">
          <div className="control-card card-surface">
            <div className="card-heading"><div><div className="section-kicker">01 <span>/</span> INPUT</div><h2>Inspection source</h2></div><div className="step-icon"><FileImage size={17}/></div></div>
            <p className="field-label">UPLOAD FABRIC IMAGE</p>
            <div className={`dropzone ${dragging ? "dropzone-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") inputRef.current?.click(); }}>
              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0])}/>
              <div className="upload-icon"><CloudUpload size={21}/></div><div className="upload-title">Drop your fabric sample here</div><div className="upload-caption">or <span>browse files</span> to upload</div><div className="file-spec">JPG, PNG, WEBP <i/> MAX 12 MB</div>
            </div>
            <div className="input-actions"><button className={`secondary-button ${cameraOn ? "active-button" : ""}`} onClick={toggleCamera}><Video size={15}/>{cameraOn ? "Stop camera" : "Live capture"}<span className="optional-label">OPTIONAL</span></button>{file && <span className="attached-file"><Check size={13}/>{file.name.length > 18 ? `${file.name.slice(0, 15)}…` : file.name}</span>}</div>
            {cameraOn && <div className="camera-box"><video ref={videoRef} autoPlay playsInline muted/><div className="camera-status" aria-live="polite">{cameraReady ? <><span className="camera-ready-dot"/> LIVE PREVIEW READY</> : <><LoaderCircle size={11} className="spin"/> STARTING CAMERA…</>}</div><button className="capture-button" onClick={captureFrame} disabled={!cameraReady}><Camera size={15}/> {cameraReady ? "Capture frame" : "Waiting for camera"}</button></div>}
            <div className="divider-label"><span/> OR TRY A SAMPLE <span/></div>
            <div className="preset-list">{presets.map((preset, index) => <button key={preset.name} onClick={() => choosePreset(preset)} className={`preset-button ${selected.name === preset.name && isDemo ? "preset-selected" : ""}`}><div className={`preset-thumb preset-${index}`} style={{ backgroundImage: `url(${preset.image})` }}>{selected.name === preset.name && isDemo && <span className="preset-check"><Check size={11}/></span>}</div><span className="preset-copy"><strong>{preset.name}</strong><small>{preset.note}</small></span><ArrowUpRight className="preset-arrow" size={15}/></button>)}</div>
            <button className="run-button" onClick={runInspection} disabled={loading}>{loading ? <><LoaderCircle size={17} className="spin"/> ANALYZING SAMPLE</> : <><ScanLine size={17}/> RUN INSPECTION <ArrowUpRight size={15} className="run-arrow"/></>}</button>
            <div className="privacy-note"><ShieldCheck size={14}/><span>Images are processed securely and never stored on our servers.</span></div>
          </div>

          <div className="result-column">
            <div className="card-surface image-card"><div className="image-toolbar"><div><div className="section-kicker">02 <span>/</span> SAMPLE PREVIEW</div><div className="image-name">{file?.name || selected.name}<span className="image-dimensions">{file ? "UPLOADED IMAGE" : "DEMO SAMPLE"}</span></div></div><button className="icon-button" aria-label="View image"><Eye size={16}/></button></div><div className="fabric-preview"><img src={image} alt={`${file?.name || selected.name} fabric sample`} className="fabric-image"/><div className="scan-overlay"/><div className="preview-corner corner-tl"/><div className="preview-corner corner-tr"/><div className="preview-corner corner-bl"/><div className="preview-corner corner-br"/><div className="coordinate coordinate-top">X: 042.8 <span>Y: 018.2</span></div><div className="coordinate coordinate-bottom"><Crosshair size={12}/> SURFACE MAPPING ACTIVE</div>{defects.length > 0 && <div className="defect-marker" style={{ left: selected.name === "Stained Denim" ? "72%" : "46%", top: selected.name === "Stained Denim" ? "36%" : "47%" }}><span className="marker-pulse"/><span className="marker-label">DEFECT 01</span></div>}</div><div className="image-footer"><span><span className="mini-live"/> VISUAL FEED <b>●</b> {file ? "LOCAL UPLOAD" : "DEMO LIBRARY"}</span><span>100% <ChevronDown size={12}/></span></div></div>

            <div className="card-surface overview-card"><div className="overview-top"><div><div className="section-kicker">03 <span>/</span> ANALYSIS REPORT</div><h2>Quality overview</h2></div><span className="report-id">QA-{String(new Date().getFullYear()).slice(-2)}-04821</span></div><div className="overview-main"><div className={`status-tile ${badgeClasses[status]}`}><div className="status-symbol">{status === "PASS" ? <Check size={20}/> : status === "WARNING" ? <CircleAlert size={20}/> : <X size={20}/>}</div><div><div className="status-label">OVERALL STATUS</div><strong>{status}</strong></div><span className="status-indicator"/></div><div className="score-tile"><div className="score-heading"><span>QUALITY SCORE</span><span className="score-value">{result ? score : "—"}<small> / 100</small></span></div><div className="score-track"><span style={{ width: `${score}%` }} className={`score-fill ${status === "FAIL" ? "fill-fail" : status === "WARNING" ? "fill-warning" : ""}`}/></div><div className="score-caption"><span><Gauge size={12}/> QUALITY INDEX</span><span>{score >= 90 ? "EXCELLENT" : score >= 70 ? "ACCEPTABLE" : "NEEDS REVIEW"}</span></div></div></div><p className="summary-text">{result?.summary || "Upload a fabric sample and run an inspection to generate a quality report."}</p><div className="findings-heading"><span>DETECTED FINDINGS</span><span className="finding-count">{String(defects.length).padStart(2, "0")}</span></div>{defects.length ? <div className="defect-list">{defects.map((defect) => <article className="defect-item" key={defect.id}><div className={`defect-icon ${severityClasses[defect.severity]}`}><CircleAlert size={15}/></div><div className="defect-content"><div className="defect-title-row"><strong>{defect.type}</strong><span className={`severity-pill ${severityClasses[defect.severity]}`}>{defect.severity}</span></div><div className="defect-location"><Crosshair size={11}/>{defect.location_description}</div><div className="recommendation"><Lightbulb size={12}/><span>{defect.recommendation}</span></div></div><div className="confidence">{Math.round(defect.confidence * 100)}<small>%</small><span>CONF.</span></div></article>)}</div> : <div className="no-defects"><div className="no-defects-icon"><ShieldCheck size={16}/></div><div><strong>Surface looks clear</strong><span>No visible defects found in this sample.</span></div><span className="all-clear">ALL CLEAR</span></div>}<div className="report-footer"><span><Sparkles size={12}/> {result?.model_used ? (result.model_used.startsWith("gemma") ? "GEMMA 4 VISION ANALYSIS" : `FALLBACK · ${result.model_used.toUpperCase()}`) : "GEMMA 4 DEMO RESULT"}</span><span>HUMAN REVIEW RECOMMENDED</span></div></div>
          </div>
        </section>

        {error && <div className="error-banner"><CircleAlert size={16}/><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={15}/></button></div>}

        <section className="audit-section"><div className="audit-header"><div><div className="section-kicker">04 <span>/</span> TRACEABILITY</div><h2>Recent inspections</h2></div><button className="view-history">VIEW HISTORY <ArrowUpRight size={14}/></button></div><div className="audit-table"><div className="audit-table-head"><span>INSPECTION ID</span><span>FABRIC SAMPLE</span><span>DATE &amp; TIME</span><span>RESULT</span><span>FINDINGS</span><span/></div>{history.length ? history.slice(0, 4).map((entry) => <div className="audit-row" key={entry.id}><span className="audit-id"><span className="audit-dot"/>QA-{entry.id.slice(0, 6).toUpperCase()}</span><span className="audit-fabric"><FileImage size={14}/>{entry.imageName}</span><span className="audit-time"><Clock3 size={13}/>{new Date(entry.timestamp).toLocaleString()}</span><span><span className={`table-status ${badgeClasses[entry.fabric_quality]}`}>{entry.fabric_quality}</span></span><span className="audit-defects">{String(entry.defects).padStart(2, "0")} <small>issues</small></span><button className="audit-open" aria-label="Open inspection"><ArrowUpRight size={15}/></button></div>) : <div className="audit-empty"><Activity size={16}/><span>Inspection runs will appear here after you analyze an uploaded image.</span><span className="audit-local">LOCAL HISTORY</span></div>}</div><div className="audit-foot"><span><ShieldCheck size={13}/> Audit trail stored locally on this device</span><button onClick={() => { setHistory([]); localStorage.removeItem("zarea-audits"); }} disabled={!history.length}>CLEAR LOG</button></div></section>
        <footer className="page-footer"><div>© 2026 ZAREA QA STUDIO <span>·</span> BUILT FOR BETTER FABRIC</div><div><span className="footer-live"/> ALL SYSTEMS OPERATIONAL <span>·</span> V1.0.4</div></footer>
      </div>
    </main>
  );
}

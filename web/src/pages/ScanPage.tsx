import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, submitImage, submitText } from "../api";
import { useScan } from "../useScan";
import { ResultCard, ResultStateCard } from "../components/ResultCard";
import { svgIcon } from "../components/SiteNav";
import { IMAGE_ACCEPT, IMAGE_HELP, validateScreenshot } from "../imageValidation";

const MAX_TEXT = 10_000;

const IconImage = () => svgIcon(28, <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m20.5 16-5-5-8.5 8.5" /></>);
const IconX = () => svgIcon(18, <path d="M6 6l12 12M18 6 6 18" />);
const IconAlert = () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" /></>);
const IconInfo = () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5h.01" /></>);
const IconCheck = () => svgIcon(14, <path d="m5 12.5 4.5 4.5L19 7.5" />);

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* Live progress while a scan runs. Steps follow the `progress` field the API returns. */
function ScanProgress({ progress, inputType }: { progress?: string | null; inputType: "text" | "image" }) {
  const steps = inputType === "image"
    ? [{ key: "QUEUED", label: "Queued" }, { key: "EXTRACTING", label: "Reading the screenshot" }, { key: "ANALYZING", label: "Checking the message and links" }]
    : [{ key: "QUEUED", label: "Queued" }, { key: "ANALYZING", label: "Checking the message and links" }];
  const current = Math.max(0, steps.findIndex(s => s.key === progress));
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setSlow(true), 20_000); return () => window.clearTimeout(t); }, []);
  const statusText = progress === "EXTRACTING" ? "Reading screenshot text..." : progress === "ANALYZING" ? "Analyzing the SMS and checking links..." : "Your message is queued for checking...";

  return (
    <section className="sr-card ap-progress" aria-labelledby="progress-title">
      <div className="ap-progress-head">
        <span className="ap-pulse" aria-hidden="true"><span className="lp-spinner" /></span>
        <div>
          <h2 id="progress-title">Checking your message</h2>
          <p role="status" aria-live="polite" className="ap-muted">{statusText}</p>
        </div>
      </div>
      <ol className="ap-steps">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={s.key} className={`ap-step is-${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="ap-step-dot" aria-hidden="true">{state === "done" ? <IconCheck /> : null}</span>
              <span>{s.label}</span>
              {state === "done" && <span className="visually-hidden"> (done)</span>}
            </li>
          );
        })}
      </ol>
      {slow && <p className="ap-hint">This is taking a little longer than usual. You can leave this page; the result will be saved in your history.</p>}
    </section>
  );
}

export function ScanPage() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [validatingImage, setValidatingImage] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [submittedType, setSubmittedType] = useState<"text" | "image">("text");
  const selection = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const { scan, error: scanError } = useScan(scanId);

  // Thumbnail for the chosen screenshot; the object URL is released when it changes.
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Move focus to the result area when a scan starts, so screen readers follow along.
  useEffect(() => { if (scanId) resultRef.current?.focus(); }, [scanId]);

  const clearFile = () => {
    selection.current++;
    setValidatingImage(false);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const chooseFile = async (candidate: File | null) => {
    clearFile();
    setError(null);
    setImageError(null);
    if (!candidate) return;
    const request = selection.current;
    setValidatingImage(true);
    try {
      const valid = await validateScreenshot(candidate);
      if (request === selection.current) setFile(valid);
    } catch (e) {
      if (request === selection.current) setImageError(e instanceof Error ? e.message : "This image could not be read. Choose another screenshot.");
    } finally {
      if (request === selection.current) setValidatingImage(false);
    }
  };

  const submit = async () => {
    if (validatingImage || submitting || imageError) return;
    setError(null);
    if (file && text.trim()) {
      setError("Choose one input: remove the screenshot or clear the pasted text. Neither has been submitted.");
      return;
    }
    if (text.length > MAX_TEXT) { setError("SMS text must be at most 10,000 characters."); return; }
    if (!file && !text.trim()) {
      setError("Paste a message or choose a screenshot first.");
      return;
    }
    setSubmitting(true);
    setSubmittedType(file ? "image" : "text");
    try {
      const r = file ? await submitImage(file) : await submitText(text.trim());
      setScanId(r.scanId);
    } catch (e) {
      if (file && e instanceof ApiError && [400, 413, 415].includes(e.status)) {
        setImageError(e.detail);
        clearFile();
        return;
      }
      setError(
        e instanceof ApiError
          ? e.detail
          : "Couldn't reach the server. Is it running?",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setText("");
    setScanId(null);
    setError(null);
    clearFile();
    window.setTimeout(() => textRef.current?.focus(), 0);
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    if (submitting) return;
    void chooseFile(e.dataTransfer.files?.[0] ?? null);
  };

  /* ---------------- Result view ---------------- */
  if (scanId) {
    const running = (!scan || scan.status === "RUNNING") && !scanError;
    const actions = <div className="ap-actions">
      <button type="button" className="lp-btn lp-btn-primary lp-btn-lg" onClick={reset}>Scan another message</button>
      <Link to="/history" className="lp-btn lp-btn-secondary lp-btn-lg">See history</Link>
    </div>;
    return (
      <div className="ap-page" ref={resultRef} tabIndex={-1} aria-label="Scan result">
        <header className="ap-page-head">
          <h1>{running ? "Checking…" : "Your result"}</h1>
        </header>
        {running && <ScanProgress progress={scan?.progress} inputType={submittedType} />}
        {scanError && (
          <ResultStateCard tone="error" icon={<IconAlert />} title="We couldn't load the result">
            <p>{scanError}</p>
            <p>Your scan may still finish. Check your history in a moment, or try again.</p>
          </ResultStateCard>
        )}
        {scan && scan.status !== "RUNNING" && <ResultCard scan={scan} />}
        {!running && actions}
        {running && <div className="ap-actions"><button type="button" className="lp-btn lp-btn-secondary" onClick={reset}>Start over</button></div>}
      </div>
    );
  }

  /* ---------------- Input view ---------------- */
  const hasText = !!text.trim();
  const both = !!file && hasText;
  const tooLong = text.length > MAX_TEXT;
  const canSubmit = (hasText || !!file) && !both && !tooLong && !submitting && !validatingImage && !imageError;

  return (
    <div className="ap-page">
      <header className="ap-page-head">
        <h1>Check a message</h1>
        <p className="ap-lead">Paste a message or upload a screenshot. We'll tell you if it looks like a scam.</p>
      </header>

      <form className="ap-card ap-scan" onSubmit={e => { e.preventDefault(); void submit(); }} noValidate>
        <div className="ap-field-head">
          <label className="ap-label" htmlFor="msg">Paste the SMS message</label>
          {text && <button type="button" className="ap-text-btn" onClick={() => { setText(""); setError(null); textRef.current?.focus(); }} disabled={submitting}>Clear</button>}
        </div>
        <textarea
          ref={textRef}
          id="msg"
          className="ap-textarea"
          rows={8}
          placeholder="Long-press the message and copy it here…"
          value={text}
          disabled={submitting}
          aria-describedby="msg-count"
          aria-invalid={tooLong || undefined}
          onChange={(e) => { setText(e.target.value); setImageError(null); }}
        />
        <p id="msg-count" className={`ap-counter${tooLong ? " is-over" : ""}`}>
          {tooLong && <IconAlert />}
          {text.length.toLocaleString()} / {MAX_TEXT.toLocaleString()} characters{tooLong ? " — too long, shorten it" : ""}
        </p>

        <div className="ap-or" role="separator"><span>or upload a screenshot</span></div>

        {!file ? (
          <>
            <input
              ref={fileRef}
              id="shot"
              type="file"
              accept={IMAGE_ACCEPT}
              aria-describedby="image-requirements"
              disabled={submitting}
              className="visually-hidden ap-file-input"
              onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)}
            />
            <label
              htmlFor="shot"
              className={`ap-drop${dragging ? " is-dragging" : ""}${imageError ? " is-error" : ""}`}
              onDragOver={e => { e.preventDefault(); if (!dragging) setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className="ap-drop-icon">{validatingImage ? <span className="lp-spinner" aria-hidden="true" /> : <IconImage />}</span>
              {validatingImage ? (
                <span className="ap-drop-title" role="status">Checking image…</span>
              ) : (
                <>
                  <span className="ap-drop-title">
                    <span className="ap-only-pointer">Drag a screenshot here, or <u>browse</u></span>
                    <span className="ap-only-touch">Tap to choose a screenshot</span>
                  </span>
                  <span className="ap-drop-sub">From your gallery or files</span>
                </>
              )}
            </label>
          </>
        ) : (
          <div className="ap-file">
            {preview && <img src={preview} alt="Preview of the chosen screenshot" className="ap-file-thumb" />}
            <div className="ap-file-info">
              <span className="ap-file-name">{file.name}</span>
              <span className="ap-muted">{formatSize(file.size)} · Ready to check</span>
            </div>
            <button type="button" className="ap-icon-btn" onClick={clearFile} disabled={submitting} aria-label="Remove screenshot" title="Remove screenshot"><IconX /></button>
          </div>
        )}
        <p id="image-requirements" className="ap-hint">{IMAGE_HELP}</p>

        {imageError && (
          <div className="ap-alert ap-alert-error" role="alert">
            <IconAlert />
            <span><strong>Image not accepted.</strong> {imageError}</span>
            <button type="button" className="ap-icon-btn ap-alert-close" aria-label="Dismiss" onClick={() => setImageError(null)}><IconX /></button>
          </div>
        )}
        {file && (
          <p className="ap-hint">
            Crop to the original message and its sender. Avoid including previous scan results or account details.
            Submit either text or an image; clear the other input first.
          </p>
        )}
        {both && (
          <div className="ap-alert ap-alert-info" role="status">
            <IconInfo />
            <span>You've added a message <strong>and</strong> a screenshot. SafeText checks one at a time, so neither will be used yet. Clear the text or remove the screenshot to continue.</span>
          </div>
        )}
        {error && <div className="ap-alert ap-alert-error" role="alert"><IconAlert /><span>{error}</span></div>}

        <button className="lp-btn lp-btn-primary lp-btn-lg ap-submit" disabled={!canSubmit} aria-busy={submitting}>
          {submitting ? <><span className="lp-spinner" aria-hidden="true" />Scanning…</> : "Check message"}
        </button>
        {!hasText && !file && !submitting && <p className="ap-hint ap-center">Add a message or a screenshot to start.</p>}
      </form>
    </div>
  );
}

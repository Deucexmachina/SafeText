import { useRef, useState } from "react";
import { ApiError, submitImage, submitText } from "../api";
import { useScan } from "../useScan";
import { ResultCard } from "../components/ResultCard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { IMAGE_ACCEPT, IMAGE_HELP, validateScreenshot } from "../imageValidation";

export function ScanPage() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [validatingImage, setValidatingImage] = useState(false);
  const selection = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const { scan, error: scanError } = useScan(scanId);

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
    if (text.length > 10_000) { setError("SMS text must be at most 10,000 characters."); return; }
    if (!file && !text.trim()) {
      setError("Paste a message or choose a screenshot first.");
      return;
    }
    setSubmitting(true);
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
  };

  if (scanId) {
    return (
      <div>
        {(!scan || scan.status === "RUNNING") && !scanError && (
          <p className="checking" role="status">{scan?.progress === "EXTRACTING" ? "Reading screenshot text..." : scan?.progress === "ANALYZING" ? "Analyzing the SMS and checking links..." : "Your message is queued for checking..."}</p>
        )}
        {scanError && <p className="error-box">{scanError}</p>}
        {scan && scan.status !== "RUNNING" && <ResultCard scan={scan} />}
        <button className="btn-secondary" onClick={reset}>
          Check another message
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      {imageError && <ConfirmDialog mode="error" title="Image not accepted" message={imageError}
        confirmLabel="Got it" busyLabel="" busy={false}
        onConfirm={() => setImageError(null)} onCancel={() => setImageError(null)} />}
      <label className="field-label" htmlFor="msg">
        Paste the SMS message
      </label>
      <textarea
        id="msg"
        rows={7}
        placeholder="Long-press the message and copy it here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="or">
        <span>or upload a screenshot</span>
      </div>

      <div className="file-row">
        <input
          ref={fileRef}
          id="shot"
          type="file"
          accept={IMAGE_ACCEPT}
          aria-describedby="image-requirements"
          disabled={submitting}
          className="visually-hidden"
          onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)}
        />
        <label htmlFor="shot" className="btn-file">
          Choose image
        </label>
        {file && (
          <span className="file-name">
            {file.name}{" "}
            <button className="link-btn" onClick={clearFile}>
              remove
            </button>
          </span>
        )}
      </div>
      <p id="image-requirements" className="hint">{IMAGE_HELP}</p>
      {validatingImage && <p className="hint" role="status">Checking image...</p>}
      {file && (
        <p className="hint">
          The screenshot will be read for its SMS text. Submit either text or an image; clear the other input first.
        </p>
      )}

      {error && <p className="error-box">{error}</p>}

      <button className="btn-primary" onClick={submit} disabled={submitting || validatingImage}>
        {submitting ? "Sending…" : "Check message"}
      </button>
    </div>
  );
}

import { useRef, useState } from "react";
import { ApiError, submitImage, submitText } from "../api";
import { useScan } from "../useScan";
import { ResultCard } from "../components/ResultCard";

export function ScanPage() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { scan, error: scanError } = useScan(scanId);

  const clearFile = () => {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    setError(null);
    if (file && text.trim()) {
      setError("Choose one input: remove the screenshot or clear the pasted text. Neither has been submitted.");
      return;
    }
    if (text.length > 10_000) { setError("SMS text must be at most 10,000 characters."); return; }
    if (file && (file.size > 8 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/tiff"].includes(file.type))) {
      setError("Choose a PNG, JPEG, WEBP, GIF, BMP or TIFF screenshot up to 8 MB."); return;
    }
    if (!file && !text.trim()) {
      setError("Paste a message or choose a screenshot first.");
      return;
    }
    setSubmitting(true);
    try {
      const r = file ? await submitImage(file) : await submitText(text.trim());
      setScanId(r.scanId);
    } catch (e) {
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
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff"
          className="visually-hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
      {file && (
        <p className="hint">
          The screenshot will be read using OCR. Submit either text or an image; clear the other input first. Maximum image size: 8 MB.
        </p>
      )}

      {error && <p className="error-box">{error}</p>}

      <button className="btn-primary" onClick={submit} disabled={submitting}>
        {submitting ? "Sending…" : "Check message"}
      </button>
    </div>
  );
}

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
          <p className="checking">Checking your message</p>
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
        disabled={!!file}
      />

      <div className="or">
        <span>or upload a screenshot</span>
      </div>

      <div className="file-row">
        <input
          ref={fileRef}
          id="shot"
          type="file"
          accept="image/*"
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
          The screenshot will be checked. Remove it to paste text instead.
        </p>
      )}

      {error && <p className="error-box">{error}</p>}

      <button className="btn-primary" onClick={submit} disabled={submitting}>
        {submitting ? "Sending…" : "Check message"}
      </button>
    </div>
  );
}

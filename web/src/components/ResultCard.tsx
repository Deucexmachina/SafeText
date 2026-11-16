import { useEffect, useRef, useState } from "react";
import { reportScan, ApiError, type ScanResult } from "../api";

function verdictClass(v: string): string {
  switch (v) {
    case "SAFE":
      return "safe";
    case "SUSPICIOUS":
      return "suspicious";
    case "MALICIOUS":
      return "malicious";
    default:
      return "inconclusive";
  }
}

const STAGE_LABELS: Record<string, string> = {
  extraction: "text extraction",
  analysis: "analysis",
  threat_intel: "link check",
};

const VERDICT_LABELS: Record<string, string> = {
  SAFE: "Safe",
  SUSPICIOUS: "Suspicious",
  MALICIOUS: "Malicious",
  INCONCLUSIVE: "Inconclusive",
};

export function ResultCard({ scan }: { scan: ScanResult }) {
  const a = scan.analysis;
  const cls = verdictClass(a?.verdict ?? "INCONCLUSIVE");
  const flagged = scan.threatIntel?.urls.filter((u) => u.threat) ?? [];
  const [reporting, setReporting] = useState(false);
  const [expected, setExpected] = useState("SAFE");
  const [share, setShare] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reported, setReported] = useState(false);
  const [sending, setSending] = useState(false);

  async function sendReport() {
    setSending(true); setReportError("");
    try { await reportScan(scan.scanId, expected, share); setReporting(false); setReported(true); }
    catch (err) { setReportError(err instanceof ApiError ? err.detail : "Could not send the report. Please try again."); }
    finally { setSending(false); }
  }

  return (
    <section className="card result">
      {scan.status === "INCONCLUSIVE" && !a && (
        <>
          <div className="verdict verdict-inconclusive">Inconclusive</div>
          <p className="muted">
            {scan.incomplete.includes("extraction") ? "The screenshot could not be read. Try a clearer image or paste the SMS text." : "Message analysis could not finish. See the provider error below and try again after it is resolved."}
          </p>
        </>
      )}

      {scan.error && <p className="error-box" role="alert">{scan.error}</p>}

      {a && (
        <>
          <div className={`verdict verdict-${cls}`}>
            {a.verdict === "INCONCLUSIVE"
              ? "Inconclusive"
              : a.verdict[0] + a.verdict.slice(1).toLowerCase()}
          </div>

          <div className="confidence">
            <span className="confidence-num">
              Confidence {a.confidence}
            </span>
            <div className="bar">
              <div
                className={`bar-fill fill-${cls}`}
                style={{ width: `${a.confidence}%` }}
              />
            </div>
          </div>

          {scan.status === "PARTIAL" && (
            <p className="notice">
              Some checks didn't finish (
              {scan.incomplete
                .map((s) => STAGE_LABELS[s] ?? s)
                .join(", ")}
              ), so this result may be incomplete.
            </p>
          )}

          <h3>Why</h3>
          <ul className="reasons">
            {a.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>

          <h3>Details found</h3>
          <table className="entities">
            <tbody>
              <tr>
                <th>Sender</th>
                <td>{a.entities.senderId ?? "—"}</td>
              </tr>
              <tr>
                <th>Links</th>
                <td>
                  {a.entities.urls.length === 0
                    ? "—"
                    : a.entities.urls.map((u) => (
                        <div key={u} className="url">
                          {u}
                        </div>
                      ))}
                </td>
              </tr>
              <tr>
                <th>Numbers</th>
                <td>
                  {a.entities.phoneNumbers.length === 0
                    ? "—"
                    : a.entities.phoneNumbers.join(", ")}
                </td>
              </tr>
            </tbody>
          </table>

          {flagged.length > 0 && (
            <>
              <h3>Flagged links</h3>
              <ul className="reasons">
                {flagged.map((u) => (
                  <li key={u.url}>
                    <span className="url">{u.url}</span> — {u.threat === "MANUAL_BLOCK" ? "On the SafeText blocklist" : u.threat}
                  </li>
                ))}
              </ul>
            </>
          )}

          {reported ? (
            <p className="muted report-done">Thanks — your report was sent to the SafeText team.</p>
          ) : (
            <button className="link-btn report-btn" onClick={() => setReporting(true)}>
              Wrong result? Tell us.
            </button>
          )}
        </>
      )}

      {scan.extraction?.text && (
        <div className="checked-msg">
          <h3>Message checked</h3>
          {scan.extraction.note && <p className="notice">{scan.extraction.note}</p>}
          <blockquote>{scan.extraction.text}</blockquote>
        </div>
      )}

      <p className="muted scan-meta">
        Scan {scan.scanId} ·{" "}
        {new Date(scan.createdAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </p>

      {reporting && (
        <ReportDialog
          current={a?.verdict ?? "INCONCLUSIVE"}
          expected={expected} setExpected={setExpected}
          share={share} setShare={setShare}
          sending={sending} error={reportError}
          onCancel={() => { setReporting(false); setReportError(""); }}
          onConfirm={() => void sendReport()}
        />
      )}
    </section>
  );
}

function ReportDialog({ current, expected, setExpected, share, setShare, sending, error, onCancel, onConfirm }: {
  current: string; expected: string; setExpected: (v: string) => void;
  share: boolean; setShare: (v: boolean) => void;
  sending: boolean; error: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => element.close();
  }, []);
  return (
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby="report-title"
      onCancel={(e) => { e.preventDefault(); if (!sending) onCancel(); }}>
      <h2 id="report-title">Report a wrong result</h2>
      <p>
        What should this message have been? Your report helps tune the scanner.
        The message text stays private unless you choose to share it.
      </p>
      <div className="dialog-field">
        <label className="field-label" htmlFor="report-verdict">Correct verdict</label>
        <select id="report-verdict" disabled={sending} value={expected}
          onChange={(e) => setExpected(e.target.value)}>
          {Object.entries(VERDICT_LABELS).filter(([v]) => v !== current).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>
      <label className="dialog-check">
        <input type="checkbox" checked={share} disabled={sending}
          onChange={(e) => setShare(e.target.checked)} />
        Also share the message text with the SafeText team
      </label>
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="confirm-actions">
        <button ref={cancel} type="button" className="confirm-cancel" disabled={sending} onClick={onCancel}>Cancel</button>
        <button type="button" className="confirm-submit" disabled={sending} onClick={onConfirm}>
          {sending ? "Sending…" : "Send report"}
        </button>
      </div>
    </dialog>
  );
}

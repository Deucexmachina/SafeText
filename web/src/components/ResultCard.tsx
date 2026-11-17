import { useEffect, useRef, useState, type ReactNode } from "react";
import { reportScan, ApiError, type ScanResult } from "../api";
import { strings, type Lang } from "../i18n";

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

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Splits the message into spans. Links get the darker link highlight; matched
// risky phrases get the amber highlight. Longest matches win.
function highlight(text: string, parts: { phrases: string[]; links: string[] }): ReactNode[] {
  const tokens = [
    ...parts.links.map(t => ({ t, cls: "risky-link" as const })),
    ...parts.phrases.map(t => ({ t, cls: "risky" as const })),
  ].filter(x => x.t).sort((a, b) => b.t.length - a.t.length);
  if (!tokens.length) return [text];
  const pattern = new RegExp(`(${tokens.map(x => escapeRegExp(x.t)).join("|")})`, "gi");
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > last) nodes.push(text.slice(last, index));
    const cls = tokens.find(x => x.t.toLowerCase() === match[0].toLowerCase())?.cls
      ?? (parts.links.some(t => t.toLowerCase() === match[0].toLowerCase()) ? "risky-link" : "risky");
    nodes.push(<mark key={i++} className={cls}>{match[0]}</mark>);
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function ResultCard({ scan }: { scan: ScanResult }) {
  const a = scan.analysis;
  const cls = verdictClass(a?.verdict ?? "INCONCLUSIVE");
  const flagged = scan.threatIntel?.urls.filter((u) => u.threat) ?? [];
  const [lang, setLang] = useState<Lang>(() => localStorage.getItem("safetext:lang") === "tl" ? "tl" : "en");
  const t = strings[lang];
  const [reporting, setReporting] = useState(false);
  const [expected, setExpected] = useState("SAFE");
  const [share, setShare] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reported, setReported] = useState<"yes" | "report" | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => { localStorage.setItem("safetext:lang", lang); }, [lang]);

  async function sendReport(verdict: string) {
    setSending(true); setReportError("");
    try {
      await reportScan(scan.scanId, verdict, share);
      setReporting(false);
      setReported(verdict === a?.verdict ? "yes" : "report");
    } catch (err) {
      setReportError(err instanceof ApiError ? err.detail : "Could not send the report. Please try again.");
    } finally { setSending(false); }
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
          <div className="result-head">
            <div className={`verdict verdict-${cls}`}>
              {a.verdict === "INCONCLUSIVE"
                ? "Inconclusive"
                : a.verdict[0] + a.verdict.slice(1).toLowerCase()}
            </div>
            <div className="lang-toggle" role="group" aria-label="Explanation language">
              <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>English</button>
              <button type="button" className={lang === "tl" ? "active" : ""} onClick={() => setLang("tl")}>Filipino</button>
            </div>
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

          <h3>{t.whatNext}</h3>
          <ul className="reasons next-steps">
            {t.steps[a.verdict].map((step, i) => (
              <li key={i}>{step}</li>
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
            <p className="muted report-done">{reported === "yes" ? t.thanksConfirm : t.thanks}</p>
          ) : (
            <div className="verdict-check">
              <span className="muted">{t.wasRight}</span>
              <button className="page-btn" disabled={sending}
                onClick={() => void sendReport(a.verdict)}>{t.yes}</button>
              <button className="page-btn" disabled={sending}
                onClick={() => { setReporting(true); setReportError(""); }}>{t.no}</button>
            </div>
          )}
        </>
      )}

      {scan.extraction?.text && (
        <div className="checked-msg">
          <h3>Message checked</h3>
          {scan.extraction.note && <p className="notice">{scan.extraction.note}</p>}
          {(scan.riskyParts.phrases.length > 0 || scan.riskyParts.links.length > 0) && (
            <p className="hint">{t.riskyNote}</p>
          )}
          <blockquote>{highlight(scan.extraction.text, scan.riskyParts)}</blockquote>
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
          onConfirm={() => void sendReport(expected)}
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

import { useEffect, useRef, useState } from "react";
import { reportScan, ApiError, type ScanResult } from "../api";
import { svgIcon } from "./SiteNav";
import { VERDICT_META, friendlyDate, verdictKind } from "./verdict";

const STAGE_LABELS: Record<string, string> = {
  extraction: "reading the screenshot",
  analysis: "message analysis",
  threat_intel: "link check",
};

const VERDICT_LABELS: Record<string, string> = {
  SAFE: "Safe",
  SUSPICIOUS: "Suspicious",
  MALICIOUS: "Malicious",
  INCONCLUSIVE: "Inconclusive",
};

// Plain-language names for the link-check results the API returns.
const THREAT_LABELS: Record<string, string> = {
  SOCIAL_ENGINEERING: "Known phishing or deceptive site",
  MALWARE: "Known malware site",
  UNWANTED_SOFTWARE: "Known unwanted-software site",
  MANUAL_BLOCK: "On the SafeText blocklist",
};

const IconUser = () => svgIcon(15, <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.5 3.8-5 7-5s5.8 1.5 7 5" /></>);
const IconLink = () => svgIcon(15, <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);
const IconPhone = () => svgIcon(15, <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />);
const IconHand = () => svgIcon(20, <><path d="M12 3v9" /><path d="M8.5 5.5V12" /><path d="M15.5 5.5V12" /><path d="M5.5 9v5a6.5 6.5 0 0 0 13 0V9" /></>);
const IconInfo = () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5h.01" /></>);
const IconAlert = () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" /></>);

function Chips({ icon, items, mono }: { icon: JSX.Element; items: string[]; mono?: boolean }) {
  if (items.length === 0) return <span className="ap-muted">None found</span>;
  return <ul className="ap-chips">{items.map(v => <li key={v} className={`ap-chip${mono ? " ap-chip-mono" : ""}`}>{icon}<span>{v}</span></li>)}</ul>;
}

export function ResultCard({ scan }: { scan: ScanResult }) {
  const a = scan.analysis;
  const kind = verdictKind(a?.verdict ?? "INCONCLUSIVE");
  const meta = VERDICT_META[kind];
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

  const unreadable = scan.incomplete.includes("extraction");
  const summary = a ? meta.summary
    : unreadable ? "The screenshot could not be read. Try a clearer image or paste the SMS text."
    : "Message analysis could not finish. See the provider error below and try again after it is resolved.";

  return (
    <section className={`ap-card ap-result ap-result-${kind}`} aria-labelledby="verdict-title">
      {/* Verdict header: icon + label + plain summary (never colour alone) */}
      <div className="ap-verdict">
        <span className="ap-verdict-icon" aria-hidden="true"><meta.Icon size={30} /></span>
        <div>
          <p className="ap-verdict-kicker">Verdict</p>
          <h2 id="verdict-title" className="ap-verdict-label">{meta.label}</h2>
          <p className="ap-verdict-summary">{summary}</p>
        </div>
      </div>

      {a && (
        <div className="ap-confidence">
          <div className="ap-confidence-row">
            <span>Confidence</span>
            <strong>{a.confidence}<span className="ap-muted">/100</span></strong>
          </div>
          <div className="ap-meter" role="meter" aria-label="Confidence" aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.confidence}>
            <span style={{ width: `${a.confidence}%` }} />
          </div>
        </div>
      )}

      {(kind === "suspicious" || kind === "malicious") && (
        <div className="ap-alert ap-alert-warn">
          <IconHand />
          <span><strong>Don't click links in suspicious messages.</strong> Don't reply or send money. If it says it's from your bank, e-wallet, or school, contact them through their official app or website instead.</span>
        </div>
      )}

      {!a && unreadable && (
        <div className="ap-alert ap-alert-info">
          <IconInfo />
          <span><strong>Tips for a clearer result:</strong> use an uncropped screenshot that shows the sender and the whole message, make sure the text is sharp, or paste the message text instead.</span>
        </div>
      )}

      {scan.status === "PARTIAL" && (
        <div className="ap-alert ap-alert-info">
          <IconInfo />
          <span>Some checks didn't finish ({scan.incomplete.map((s) => STAGE_LABELS[s] ?? s).join(", ")}), so this result may be incomplete.</span>
        </div>
      )}

      {scan.error && (
        <div className="ap-alert ap-alert-error" role="alert">
          <IconAlert />
          <span><strong>What went wrong:</strong> {scan.error}</span>
        </div>
      )}

      {a && (
        <>
          <h3 className="ap-section-h">Why</h3>
          <ul className="ap-reasons">
            {a.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>

          <h3 className="ap-section-h">Details found</h3>
          <dl className="ap-details">
            <div><dt>Sender</dt><dd><Chips icon={<IconUser />} items={a.entities.senderId ? [a.entities.senderId] : []} /></dd></div>
            <div><dt>Links</dt><dd><Chips icon={<IconLink />} items={a.entities.urls} mono /></dd></div>
            <div><dt>Phone numbers</dt><dd><Chips icon={<IconPhone />} items={a.entities.phoneNumbers} /></dd></div>
          </dl>

          {flagged.length > 0 && (
            <>
              <h3 className="ap-section-h">Flagged links</h3>
              <ul className="ap-flagged">
                {flagged.map((u) => (
                  <li key={u.url}>
                    <IconAlert />
                    <span><code>{u.url}</code><span className="ap-muted"> — {THREAT_LABELS[u.threat ?? ""] ?? u.threat}</span></span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {scan.extraction?.text && (
        <details className="ap-checked" open={!a}>
          <summary>Message checked</summary>
          {scan.extraction.note && <p className="ap-hint">{scan.extraction.note}</p>}
          <blockquote>{scan.extraction.text}</blockquote>
        </details>
      )}

      <div className="ap-result-foot">
        <p className="ap-muted">Checked {friendlyDate(scan.createdAt)} · Scan {scan.scanId}</p>
        {a && (reported ? (
          <p className="ap-muted" role="status">Thanks — your report was sent to the SafeText team.</p>
        ) : (
          <button type="button" className="ap-text-btn" onClick={() => setReporting(true)}>Wrong result? Tell us.</button>
        ))}
      </div>

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
  const options = Object.entries(VERDICT_LABELS).filter(([v]) => v !== current);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    // The default verdict must be one of the offered options.
    if (!options.some(([v]) => v === expected)) setExpected(options[0][0]);
    return () => element.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
          {options.map(([v, label]) => (
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
        <button type="button" className="confirm-submit" disabled={sending} aria-busy={sending} onClick={onConfirm}>
          {sending ? <><span className="lp-spinner" aria-hidden="true" />Sending…</> : "Send report"}
        </button>
      </div>
    </dialog>
  );
}

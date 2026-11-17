import { useEffect, useRef, useState, type ReactNode } from "react";
import { reportScan, ApiError, type ScanResult } from "../api";
import { strings, type Lang } from "../i18n";
import { svgIcon } from "./SiteNav";
import { VerdictTag, friendlyDate, verdictKind, type VerdictKind } from "./verdict";
import "../result.css";

/* The one scan-result card, used wherever a result is shown (right after a scan
   and on /scan/:id, for every user including admins), so they always match.
   Layout mirrors the landing page's "Example result" card. */

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

// Plain-language names for the link-check results the API returns.
const THREAT_LABELS: Record<string, string> = {
  SOCIAL_ENGINEERING: "Known phishing or deceptive site",
  MALWARE: "Known malware site",
  UNWANTED_SOFTWARE: "Known unwanted-software site",
  MANUAL_BLOCK: "On the SafeText blocklist",
};

const REASONS_SHOWN = 3;

const IconCheck = ({ size = 16 }: { size?: number }) => svgIcon(size, <path d="m5 12.5 4.5 4.5L19 7.5" />);
const IconAlert = () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" /></>);
const IconInfo = () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5h.01" /></>);
const IconHand = () => svgIcon(16, <><path d="M12 3v9" /><path d="M8.5 5.5V12" /><path d="M15.5 5.5V12" /><path d="M5.5 9v5a6.5 6.5 0 0 0 13 0V9" /></>);
const IconCopy = () => svgIcon(15, <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>);
const IconList = () => svgIcon(18, <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" /></>);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Splits the message into spans. Links get the link highlight; matched risky
// phrases get the phrase highlight. Longest matches win.
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

/* Display-only tidy-up: drop unbalanced brackets (e.g. "+632) 8845") and show
   each value once, comparing phone numbers by their digits. */
function tidy(value: string) {
  const open = (value.match(/\(/g) ?? []).length, close = (value.match(/\)/g) ?? []).length;
  return (open === close ? value : value.replace(/[()]/g, "")).trim();
}
function unique(values: string[], key: (v: string) => string = v => v.toLowerCase()) {
  const seen = new Set<string>();
  return values.map(tidy).filter(v => { const k = key(v); if (!v || seen.has(k)) return false; seen.add(k); return true; });
}

/* Cards for non-result states (loading, checking, error), in the same style. */
export function ResultStateCard({ tone = "info", icon, title, children, live }: {
  tone?: "info" | "error"; icon: ReactNode; title: string; children?: ReactNode; live?: boolean;
}) {
  return (
    <section className={`sr-card sr-state sr-state-${tone}`} role={tone === "error" ? "alert" : undefined} aria-live={live ? "polite" : undefined}>
      <span className="sr-state-icon" aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function readLang(): Lang {
  try { return localStorage.getItem("safetext:lang") === "tl" ? "tl" : "en"; } catch { return "en"; }
}

export function ResultCard({ scan }: { scan: ScanResult }) {
  const a = scan.analysis;
  const verdict = a?.verdict ?? "INCONCLUSIVE";
  const kind: VerdictKind = verdictKind(verdict);
  const risky = kind === "suspicious" || kind === "malicious";
  const flagged = scan.threatIntel?.urls.filter((u) => u.threat) ?? [];
  const [lang, setLang] = useState<Lang>(readLang);
  const t = strings[lang];
  const [reporting, setReporting] = useState(false);
  const [expected, setExpected] = useState("SAFE");
  const [share, setShare] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reported, setReported] = useState<"yes" | "report" | null>(null);
  const [sending, setSending] = useState(false);
  const [allReasons, setAllReasons] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { try { localStorage.setItem("safetext:lang", lang); } catch { /* storage unavailable */ } }, [lang]);
  useEffect(() => { if (!copied) return; const id = window.setTimeout(() => setCopied(false), 2000); return () => window.clearTimeout(id); }, [copied]);

  async function sendReport(v: string) {
    setSending(true); setReportError("");
    try {
      await reportScan(scan.scanId, v, share);
      setReporting(false);
      setReported(v === a?.verdict ? "yes" : "report");
    } catch (err) {
      setReportError(err instanceof ApiError ? err.detail : "Could not send the report. Please try again.");
    } finally { setSending(false); }
  }

  function openReport() {
    // Start on a verdict that differs from the current one (the dialog only lists those).
    setExpected(Object.keys(VERDICT_LABELS).find(v => v !== verdict) ?? "SAFE");
    setReportError("");
    setReporting(true);
  }

  async function copyId() {
    try { await navigator.clipboard.writeText(scan.scanId); setCopied(true); return; }
    catch { /* fall back below */ }
    // Older or stricter browsers: copy through a temporary, off-screen text field.
    const field = Object.assign(document.createElement("textarea"), { value: scan.scanId, readOnly: true });
    field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(field);
    field.select();
    try { if (document.execCommand("copy")) setCopied(true); } catch { /* the ID stays visible and selectable */ }
    field.remove();
  }

  const reasons = a?.reasons ?? [];
  const visibleReasons = allReasons ? reasons : reasons.slice(0, REASONS_SHOWN);
  const links = unique(a?.entities.urls ?? []);
  const phones = unique(a?.entities.phoneNumbers ?? [], v => v.replace(/\D/g, "").replace(/^63/, "0"));
  const sender = a?.entities.senderId && !/^unknown$/i.test(a.entities.senderId.trim()) ? a.entities.senderId : null;
  const hasHighlights = scan.riskyParts.phrases.length > 0 || scan.riskyParts.links.length > 0;
  const steps = t.steps[verdict] ?? [];

  return (
    <section className={`sr-card sr-${kind}`} aria-labelledby="sr-verdict">
      {/* a. Verdict row */}
      <div className="sr-head">
        <h2 id="sr-verdict" className="sr-verdict"><span className="visually-hidden">Verdict: </span><VerdictTag kind={kind} size="lg" /></h2>
        <div className="sr-lang" role="group" aria-label="Explanation language">
          <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
          <button type="button" aria-pressed={lang === "tl"} onClick={() => setLang("tl")}>Filipino</button>
        </div>
      </div>

      {/* b. Confidence */}
      {a ? (
        <div className="sr-confidence">
          <p className="sr-score"><strong>{a.confidence}</strong>/100 confidence</p>
          <div className="sr-meter" role="meter" aria-label="Confidence" aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.confidence}>
            <span style={{ width: `${a.confidence}%` }} />
          </div>
        </div>
      ) : (
        <p className="sr-lead">
          {scan.incomplete.includes("extraction") ? "The screenshot could not be read. Try a clearer image or paste the SMS text." : "Message analysis could not finish. See the provider error below and try again after it is resolved."}
        </p>
      )}

      {scan.status === "PARTIAL" && (
        <p className="sr-alert sr-alert-info"><IconInfo /><span>Some checks didn't finish ({scan.incomplete.map((s) => STAGE_LABELS[s] ?? s).join(", ")}), so this result may be incomplete.</span></p>
      )}
      {scan.error && <p className="sr-alert sr-alert-error" role="alert"><IconAlert /><span><strong>What went wrong:</strong> {scan.error}</span></p>}

      {/* c. Message checked */}
      {scan.extraction?.text && (
        <div className="sr-section">
          <h3 className="sr-label">Message checked</h3>
          {scan.extraction.note && <p className="sr-note">{scan.extraction.note}</p>}
          <blockquote className={`sr-bubble${risky ? " is-risky" : " is-calm"}`}>
            {sender && <span className="sr-bubble-from">{sender}</span>}
            {highlight(scan.extraction.text, scan.riskyParts)}
          </blockquote>
          {hasHighlights && <p className="sr-note">{risky ? t.riskyNote : "Words SafeText looked at closely are underlined."}</p>}
          {risky && <p className="sr-reminder"><IconHand /><span>Don't click links in suspicious messages.</span></p>}
        </div>
      )}

      {/* d. Why */}
      {reasons.length > 0 && (
        <div className="sr-section">
          <h3 className="sr-label">Why</h3>
          <ul className="sr-reasons" id="sr-reasons">
            {visibleReasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {reasons.length > REASONS_SHOWN && (
            <button type="button" className="sr-link-btn" aria-expanded={allReasons} aria-controls="sr-reasons" onClick={() => setAllReasons(v => !v)}>
              {allReasons ? "Show fewer reasons" : `Show all ${reasons.length} reasons`}
            </button>
          )}
        </div>
      )}

      {/* e. What to do next */}
      {steps.length > 0 && (
        <div className="sr-next" aria-labelledby="sr-next-title" role="region">
          <h3 id="sr-next-title" className="sr-next-title"><IconList />{t.whatNext}</h3>
          <ul className="sr-steps">
            {steps.map((step, i) => <li key={i}><span className="sr-step-check" aria-hidden="true"><IconCheck size={13} /></span><span>{step}</span></li>)}
          </ul>
        </div>
      )}

      {/* f. Details found */}
      {a && (
        <div className="sr-section">
          <h3 className="sr-label">Details found</h3>
          <dl className="sr-details">
            <div><dt>Sender ID</dt><dd>{sender ? <code>{sender}</code> : <span className="sr-empty">Not detected</span>}</dd></div>
            <div><dt>{links.length === 1 ? "Link" : "Links"}</dt><dd>{links.length ? links.map(l => <code key={l}>{l}</code>) : <span className="sr-empty">None found</span>}</dd></div>
            <div><dt>Phone numbers</dt><dd>{phones.length ? phones.map(p => <code key={p}>{p}</code>) : <span className="sr-empty">None found</span>}</dd></div>
          </dl>
          {flagged.length > 0 && (
            <ul className="sr-flagged" aria-label="Flagged links">
              {flagged.map((u) => (
                <li key={u.url}><IconAlert /><span><code>{u.url}</code> — {THREAT_LABELS[u.threat ?? ""] ?? u.threat}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* g. Feedback */}
      {a && (reported ? (
        <p className="sr-feedback sr-thanks" role="status"><IconCheck />{reported === "yes" ? t.thanksConfirm : t.thanks}</p>
      ) : (
        <div className="sr-feedback">
          <span>{t.wasRight}</span>
          <div className="sr-feedback-btns">
            <button type="button" className="sr-quiet-btn" disabled={sending} aria-busy={sending && !reporting} onClick={() => void sendReport(a.verdict)}>{t.yes}</button>
            <button type="button" className="sr-quiet-btn" disabled={sending} onClick={openReport}>{t.no}</button>
          </div>
        </div>
      ))}

      {/* Footer */}
      <footer className="sr-foot">
        <span>Scan <code>{scan.scanId}</code> · {friendlyDate(scan.createdAt)}</span>
        <button type="button" className="sr-copy" onClick={() => void copyId()} aria-label={copied ? "Scan ID copied" : "Copy scan ID"}>
          {copied ? <IconCheck size={15} /> : <IconCopy />}<span>{copied ? "Copied" : "Copy ID"}</span>
        </button>
        <span className="visually-hidden" role="status">{copied ? "Scan ID copied" : ""}</span>
      </footer>

      {reporting && (
        <ReportDialog
          current={verdict}
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
        <button type="button" className="confirm-submit" disabled={sending} aria-busy={sending} onClick={onConfirm}>
          {sending ? <><span className="lp-spinner" aria-hidden="true" />Sending…</> : "Send report"}
        </button>
      </div>
    </dialog>
  );
}

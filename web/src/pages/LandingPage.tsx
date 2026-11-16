import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { User } from "../api";
import { AuthPage } from "./AuthPage";
import { Logo, SiteNav, useSiteTheme, type AuthMode } from "../components/SiteNav";
import "../landing.css";

/* ------------------------------------------------------------------ */
/* Icons (decorative unless labelled; text always carries the meaning) */
/* ------------------------------------------------------------------ */

type IconProps = { size?: number };
const svg = (size: number, children: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);
const IconSafe = ({ size = 20 }: IconProps) => svg(size, <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m8.8 12.2 2.2 2.2 4.3-4.6" /></>);
const IconSuspicious = ({ size = 20 }: IconProps) => svg(size, <><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4" /><path d="M12 17h.01" /></>);
const IconMalicious = ({ size = 20 }: IconProps) => svg(size, <><path d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2l5.7-5.7Z" /><path d="m9 9 6 6M15 9l-6 6" /></>);
const IconInconclusive = ({ size = 20 }: IconProps) => svg(size, <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.3-2.4 3.8" /><path d="M12 17h.01" /></>);
const IconPaste = ({ size = 24 }: IconProps) => svg(size, <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4" /></>);
const IconScan = ({ size = 24 }: IconProps) => svg(size, <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /><path d="M8.5 11h5" /></>);
const IconVerdict = ({ size = 24 }: IconProps) => svg(size, <><path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="m8.8 10.2 2.2 2.2 4.3-4.4" /></>);
const IconLock = ({ size = 22 }: IconProps) => svg(size, <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>);
const IconImage = ({ size = 22 }: IconProps) => svg(size, <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m20.5 16-5-5-8.5 8.5" /></>);
const IconEyeOff = ({ size = 22 }: IconProps) => svg(size, <><path d="M3 3l18 18" /><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>);
const IconKey = ({ size = 22 }: IconProps) => svg(size, <><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 9.2-9.2M17 6l2.5 2.5M14.5 8.5 16.5 10.5" /></>);
const IconHistory = ({ size = 22 }: IconProps) => svg(size, <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v4h4" /><path d="M12 8v4.5l3 2" /></>);
const IconClose = () => svg(20, <path d="M6 6l12 12M18 6 6 18" />);

const VERDICT_ICON = { safe: IconSafe, suspicious: IconSuspicious, malicious: IconMalicious, inconclusive: IconInconclusive };
type VerdictKey = keyof typeof VERDICT_ICON;

function VerdictTag({ kind, label }: { kind: VerdictKey; label: string }) {
  const Icon = VERDICT_ICON[kind];
  return <span className={`lp-tag lp-tag-${kind}`}><Icon size={16} />{label}</span>;
}

/* ------------------------------------------------------------------ */
/* Auth modal: wraps the existing AuthPage, so fields and logic match  */
/* ------------------------------------------------------------------ */

function AuthDialog({ mode, note, onClose, onLogin }: { mode: AuthMode | null; note?: string; onClose: () => void; onLogin: (user: User) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (mode && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLInputElement>("#email")?.focus();
    } else if (!mode && dialog.open) dialog.close();
  }, [mode]);
  return (
    <dialog ref={ref} className="lp-dialog" aria-labelledby="auth-title" onClose={onClose}
      onClick={e => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="lp-dialog-body">
        <button type="button" className="lp-dialog-close" aria-label="Close" onClick={() => ref.current?.close()}><IconClose /></button>
        {mode && <AuthPage key={mode} initialAction={mode} note={note} onLogin={onLogin} />}
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page content                                                        */
/* ------------------------------------------------------------------ */

const STEPS = [
  { icon: IconPaste, title: "Paste or upload", body: "Copy the text message, or upload a screenshot of it." },
  { icon: IconScan, title: "We analyze it", body: "SafeText reads the message and looks for common scam signs, like pressure, fake brands, and risky links." },
  { icon: IconVerdict, title: "Get a verdict with reasons", body: "See a verdict, a confidence score, and the reasons behind it, in plain language." },
];

const VERDICTS: { kind: VerdictKey; label: string; body: string }[] = [
  { kind: "safe", label: "Safe", body: "No common scam signs found. Still take care with links and money requests." },
  { kind: "suspicious", label: "Suspicious", body: "Some warning signs. Don't click or reply until you confirm with the sender another way." },
  { kind: "malicious", label: "Malicious", body: "Strong scam signs. Don't click, reply, or send money." },
  { kind: "inconclusive", label: "Inconclusive", body: "We couldn't read it clearly, often from a blurry or cropped screenshot. Try pasting the text instead." },
];

const SCAMS = [
  { title: "Fake GCash alert", example: "“Your account will be suspended. Verify now.”", sign: "It sends you to a link to “verify” instead of telling you to open the official app." },
  { title: "Courier fee", example: "“Your parcel is on hold. Pay ₱49 to re-deliver.”", sign: "It asks for a small fee for a parcel you weren't expecting." },
  { title: "Job offer", example: "“Earn ₱3,000 a day liking posts. Message us!”", sign: "The pay is too high for easy work, and they ask you to pay or “top up” first." },
  { title: "Prize or loan", example: "“Congrats! Your loan / raffle prize is approved.”", sign: "You won or got approved for something you never joined or applied for." },
];

const FAQS = [
  { q: "Is SafeText always right?", a: "No. SafeText is an awareness aid, not a guarantee. It can miss new tricks or flag a real message. Use the reasons to decide, and when in doubt, don't click." },
  { q: "What should I do if a message is marked Malicious?", a: "Don't click links, reply, or send money. If it claims to be from your bank, e-wallet, or school, contact them through their official app, website, or hotline. Never use the details in the message." },
  { q: "Can I check a screenshot instead of pasting text?", a: "Yes. Use a clear, uncropped screenshot that shows the sender and the full message. If we can't read it, you'll get an Inconclusive result, and you can paste the text instead." },
  { q: "Who can see the messages I check?", a: "Your scan history is private to your account. Screenshots are kept only until the text is read, and message text is redacted from our logs." },
  { q: "Do I need an account?", a: "Yes. An account lets you check messages and keeps your scan history private, so you can come back to past results." },
];

/* ------------------------------------------------------------------ */

export function LandingPage({ onLogin, notices }: { onLogin: (user: User) => void; notices?: ReactNode }) {
  const [theme, toggleTheme] = useSiteTheme();
  const [auth, setAuth] = useState<{ mode: AuthMode; note?: string } | null>(null);
  const [params, setParams] = useSearchParams();

  // Links from other public pages (e.g. "Back to log in") arrive as /?auth=login.
  useEffect(() => {
    const requested = params.get("auth");
    if (requested !== "login" && requested !== "register") return;
    setAuth({ mode: requested });
    setParams({}, { replace: true });
  }, [params, setParams]);

  const openAuth = (mode: AuthMode, note?: string) => setAuth({ mode, note });
  const checkMessage = () => openAuth("register", "Create an account or log in to check your first message.");

  return (
    <div className="lp" data-theme={theme} id="top">
      {/* 1. Navbar (shared with the password-recovery pages) */}
      <SiteNav theme={theme} onToggleTheme={toggleTheme} onAuth={openAuth} />

      {notices && <div className="lp-wrap lp-notices">{notices}</div>}

      <main id="main-content" tabIndex={-1}>
        {/* 2. Hero */}
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-eyebrow"><IconSafe size={16} />A campus scam-awareness project</p>
              <h1 id="hero-title">Got a strange text? Check it before you tap.</h1>
              <p className="lp-lead">Paste a suspicious text or screenshot and see if it looks like a scam, and why.</p>
              <div className="lp-cta-row">
                <button type="button" className="lp-btn lp-btn-primary lp-btn-lg" onClick={checkMessage}>Check a message</button>
                <button type="button" className="lp-btn lp-btn-secondary lp-btn-lg" onClick={() => openAuth("login")}>Log in</button>
              </div>
              <p className="lp-fineprint">An awareness aid, not a guarantee. When in doubt, don't click.</p>
            </div>

            <figure className="lp-result" aria-label="Example result for a fake GCash text">
              <figcaption className="lp-result-cap">Example result</figcaption>
              <blockquote className="lp-sms">
                <span className="lp-sms-from">GCASH-ALRT</span>
                G-Cash: Your account will be SUSPENDED in 24 hrs. Verify now at gcash-verify.top
              </blockquote>
              <div className="lp-result-head">
                <VerdictTag kind="malicious" label="Malicious" />
                <span className="lp-score"><strong>91</strong>/100 confidence</span>
              </div>
              <div className="lp-meter" role="img" aria-label="Confidence 91 out of 100"><span style={{ width: "91%" }} /></div>
              <h2 className="lp-result-h">Why</h2>
              <ul className="lp-reasons">
                <li>Urgency + account-suspension threat</li>
                <li>Misspelled brand name</li>
              </ul>
              <h2 className="lp-result-h">Details found</h2>
              <dl className="lp-details">
                <div><dt>Sender ID</dt><dd><code>GCASH-ALRT</code></dd></div>
                <div><dt>Link</dt><dd><code>gcash-verify.top</code></dd></div>
                <div><dt>Phone numbers</dt><dd>None found</dd></div>
              </dl>
            </figure>
          </div>
        </section>

        {/* 3. How it works */}
        <section id="how-it-works" className="lp-section" aria-labelledby="how-title">
          <div className="lp-wrap">
            <h2 id="how-title" className="lp-h2">How it works</h2>
            <p className="lp-sub">Three steps. No tech skills needed.</p>
            <ol className="lp-steps">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="lp-card">
                  <span className="lp-step-num" aria-hidden="true">{i + 1}</span>
                  <span className="lp-icon-chip"><Icon /></span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 4. Verdicts */}
        <section className="lp-section lp-tint" aria-labelledby="verdicts-title">
          <div className="lp-wrap">
            <h2 id="verdicts-title" className="lp-h2">What the verdicts mean</h2>
            <p className="lp-sub">Every result includes a confidence score from 0 to 100 and the reasons behind it.</p>
            <ul className="lp-grid4">
              {VERDICTS.map(v => (
                <li key={v.kind} className={`lp-card lp-verdict lp-verdict-${v.kind}`}>
                  <VerdictTag kind={v.kind} label={v.label} />
                  <p>{v.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 5. Common campus scams */}
        <section id="common-scams" className="lp-section" aria-labelledby="scams-title">
          <div className="lp-wrap">
            <h2 id="scams-title" className="lp-h2">Common campus scams</h2>
            <p className="lp-sub">Scams like these often target students. Learn the tell-tale sign of each.</p>
            <ul className="lp-grid4">
              {SCAMS.map(s => (
                <li key={s.title} className="lp-card lp-scam">
                  <h3>{s.title}</h3>
                  <p className="lp-scam-ex">{s.example}</p>
                  <p className="lp-scam-sign"><strong>Tell-tale sign:</strong> {s.sign}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 6. Why create an account */}
        <section className="lp-section lp-tint" aria-labelledby="account-title">
          <div className="lp-wrap lp-split">
            <div>
              <h2 id="account-title" className="lp-h2">Why create an account?</h2>
              <p className="lp-sub">Your account keeps your scan history private, so only you can look back on it.</p>
              <ul className="lp-checks">
                <li>Come back to messages you've already checked.</li>
                <li>Open a past result to see its reasons again.</li>
                <li>Your history stays with your account, not on a public page.</li>
              </ul>
              <button type="button" className="lp-btn lp-btn-primary" onClick={() => openAuth("register")}>Create an account</button>
            </div>
            <div className="lp-card lp-history" aria-hidden="true">
              <p className="lp-history-title"><IconHistory size={18} />Your scan history</p>
              <ul>
                <li><span>“Your parcel is on hold…”</span><VerdictTag kind="suspicious" label="Suspicious" /></li>
                <li><span>“G-Cash: Your account will be…”</span><VerdictTag kind="malicious" label="Malicious" /></li>
                <li><span>“Class moved to Room 204…”</span><VerdictTag kind="safe" label="Safe" /></li>
              </ul>
            </div>
          </div>
        </section>

        {/* 7. Privacy */}
        <section className="lp-section" aria-labelledby="privacy-title">
          <div className="lp-wrap">
            <h2 id="privacy-title" className="lp-h2">How we handle your messages</h2>
            <ul className="lp-grid3">
              <li className="lp-card lp-privacy"><span className="lp-icon-chip"><IconImage /></span><h3>Screenshots are short-lived</h3><p>Screenshots are kept only until we finish reading the text from them.</p></li>
              <li className="lp-card lp-privacy"><span className="lp-icon-chip"><IconEyeOff /></span><h3>Redacted from logs</h3><p>Message text is redacted from our logs.</p></li>
              <li className="lp-card lp-privacy"><span className="lp-icon-chip"><IconKey /></span><h3>Keys stay on the server</h3><p>The secret keys SafeText uses never reach your browser.</p></li>
            </ul>
          </div>
        </section>

        {/* 8. FAQ */}
        <section id="faq" className="lp-section lp-tint" aria-labelledby="faq-title">
          <div className="lp-wrap lp-narrow">
            <h2 id="faq-title" className="lp-h2">Questions</h2>
            <div className="lp-faq">
              {FAQS.map(f => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-final" aria-labelledby="final-title">
          <div className="lp-wrap lp-narrow">
            <span className="lp-final-icon"><IconLock /></span>
            <h2 id="final-title">Not sure about a text? Check it first.</h2>
            <p>Paste it or upload a screenshot. Your history stays private.</p>
            <div className="lp-cta-row lp-cta-center">
              <button type="button" className="lp-btn lp-btn-light lp-btn-lg" onClick={checkMessage}>Check a message</button>
              <button type="button" className="lp-btn lp-btn-outline-light lp-btn-lg" onClick={() => openAuth("login")}>Log in</button>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <div>
            <Logo href="#top" />
            <p>Developed by Group Nano</p>
          </div>
          <p className="lp-footer-note">An awareness aid, not a guarantee. When in doubt, don't click.</p>
        </div>
      </footer>

      <AuthDialog mode={auth?.mode ?? null} note={auth?.note} onClose={() => setAuth(null)} onLogin={onLogin} />
    </div>
  );
}

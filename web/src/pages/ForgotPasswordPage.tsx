import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, forgotPassword, resetPassword, verifyResetCode } from "../api";
import { PasswordInput } from "../components/PasswordInput";
import { SiteNav, svgIcon, useSiteTheme } from "../components/SiteNav";
import "../landing.css";
import "../recovery.css";

type Step = "email" | "code" | "password" | "done";

const CODE_LENGTH = 6;
const LOGIN_HREF = "/?auth=login";
const emptyDigits = () => Array<string>(CODE_LENGTH).fill("");

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Unable to reach the server.";
}

const IconBack = () => svgIcon(18, <path d="M19 12H5m6-6-6 6 6 6" />);
const IconCheck = ({ size = 16 }: { size?: number }) => svgIcon(size, <path d="m5 12.5 4.5 4.5L19 7.5" />);
const IconAlert = () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" /></>);
const IconInfo = () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5h.01" /></>);
const IconMail = () => svgIcon(26, <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></>);
const IconKey = () => svgIcon(26, <><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 9.2-9.2M17 6l2.5 2.5M14.5 8.5 16.5 10.5" /></>);
const IconLock = () => svgIcon(26, <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>);
const IconCross = () => svgIcon(16, <path d="M7 7l10 10M17 7 7 17" />);
const IconDot = () => svgIcon(16, <circle cx="12" cy="12" r="3" />);

/* ------------------------------------------------------------------ */

function StepIndicator({ step }: { step: Step }) {
  const steps = ["Email", "Code", "New password"];
  const current = step === "email" ? 0 : step === "code" ? 1 : step === "password" ? 2 : 3;
  return (
    <ol className="rc-steps" aria-label="Reset progress">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={label} className={`rc-step-item is-${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="rc-step-dot" aria-hidden="true">{state === "done" ? <IconCheck size={14} /> : i + 1}</span>
            <span className="rc-step-label">{label}</span>
            {state === "done" && <span className="visually-hidden"> (completed)</span>}
          </li>
        );
      })}
    </ol>
  );
}

function ErrorMessage({ id, children }: { id: string; children: ReactNode }) {
  return <p id={id} role="alert" className="rc-alert rc-alert-error"><IconAlert /><span>{children}</span></p>;
}

function SubmitButton({ busy, busyLabel, children, disabled = false }: { busy: boolean; busyLabel: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button className="lp-btn lp-btn-primary lp-btn-lg rc-submit" disabled={busy || disabled} aria-busy={busy}>
      {busy ? <><span className="lp-spinner" aria-hidden="true" />{busyLabel}</> : children}
    </button>
  );
}

/* Six single-digit boxes. Typing advances, Backspace steps back, arrow keys move,
   and pasting or phone autofill spreads the full code across the boxes. */
function CodeBoxes({ digits, onChange, disabled, invalid, describedBy }: {
  digits: string[];
  onChange: (digits: string[]) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focusBox = (i: number) => refs.current[Math.max(0, Math.min(CODE_LENGTH - 1, i))]?.focus();

  function fillFrom(start: number, value: string) {
    const next = [...digits];
    const chars = value.replace(/\D/g, "").slice(0, CODE_LENGTH - start).split("");
    chars.forEach((c, k) => { next[start + k] = c; });
    onChange(next);
    focusBox(start + chars.length);
  }

  function handleChange(i: number, raw: string) {
    const value = raw.replace(/\D/g, "");
    if (!value) { const next = [...digits]; next[i] = ""; onChange(next); return; }
    fillFrom(value.length >= CODE_LENGTH ? 0 : i, value);
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      const next = [...digits]; next[i - 1] = ""; onChange(next); focusBox(i - 1);
    } else if (e.key === "ArrowLeft") { e.preventDefault(); focusBox(i - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); focusBox(i + 1); }
  }

  function handlePaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    e.preventDefault();
    fillFrom(pasted.length >= CODE_LENGTH ? 0 : i, pasted);
  }

  return (
    <fieldset className="rc-code" aria-describedby={describedBy}>
      <legend className="field-label">Verification code</legend>
      <div className="rc-code-row">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={el => { refs.current[i] = el; }}
            id={i === 0 ? "code" : undefined}
            className="rc-code-box"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1} of ${CODE_LENGTH}`}
            aria-invalid={invalid || undefined}
            value={d}
            disabled={disabled}
            onFocus={e => e.target.select()}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            onPaste={e => handlePaste(i, e)}
          />
        ))}
      </div>
    </fieldset>
  );
}

/* Guidance only: the meter never blocks submission. The only enforced rule
   is the existing 12–128 character length check. */
function strength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "" };
  if (pw.length < 12) return { score: 1, label: "Too short" };
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  let score = 2;
  if (pw.length >= 16 || variety >= 3) score++;
  if (pw.length >= 20 || (pw.length >= 14 && variety === 4)) score++;
  return { score, label: ["", "Too short", "Fair", "Good", "Strong"][score] };
}

function Requirement({ met, pending, children }: { met: boolean; pending?: boolean; children: ReactNode }) {
  const state = pending ? "pending" : met ? "met" : "unmet";
  return (
    <li className={`rc-req is-${state}`}>
      <span className="rc-req-icon" aria-hidden="true">{state === "met" ? <IconCheck /> : state === "unmet" ? <IconCross /> : <IconDot />}</span>
      <span>{children}</span>
      <span className="visually-hidden">{state === "met" ? " — done" : state === "unmet" ? " — not yet" : ""}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ */

export function ForgotPasswordPage({ notices }: { notices?: ReactNode }) {
  const [theme, toggleTheme] = useSiteTheme();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [verifyIn, setVerifyIn] = useState(0);
  // Screen-reader-only note when a rate limit starts; the countdown button is the visible cue.
  const [limitNote, setLimitNote] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  /* A rate-limit reply (429) shows only as the "Try again in Ns" countdown on the
     button, not as a separate red message. Returns true when it was one. */
  function rateLimited(err: unknown, startCountdown: (seconds: number) => void) {
    if (!(err instanceof ApiError && err.status === 429)) return false;
    const seconds = err.retryAfter ?? 60;
    startCountdown(seconds);
    setLimitNote(`Too many attempts. You can try again in ${seconds} seconds.`);
    return true;
  }
  const code = digits.join("");

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);
  useEffect(() => {
    if (verifyIn <= 0) return;
    const timer = window.setTimeout(() => setVerifyIn(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [verifyIn]);

  useEffect(() => {
    if (step !== "done") return;
    const t = window.setTimeout(() => nav(LOGIN_HREF), 5000);
    return () => window.clearTimeout(t);
  }, [step, nav]);

  // Move focus to the first field of each step (or the heading on success).
  useEffect(() => {
    const target = { email: "#email", code: "#code", password: "#new-password", done: "h1" }[step];
    cardRef.current?.querySelector<HTMLElement>(target)?.focus();
  }, [step]);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    setError(""); setNotice(""); setLimitNote("");
    if (!email.trim()) { setError("Enter your account email."); return; }
    const resending = step !== "email";
    setBusy(true);
    try {
      const result = await forgotPassword(email.trim());
      setStep("code");
      setDigits(emptyDigits());
      setPassword("");
      setConfirm("");
      setResendIn(result.resendAfter ?? 60);
      if (resending) setNotice("If an account exists for this email, we've sent a new code. Only the newest code will work.");
    } catch (err) {
      if (!rateLimited(err, setResendIn)) setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError(""); setNotice(""); setLimitNote("");
    if (!/^\d{6}$/.test(code.trim())) { setError("Enter the 6-digit code."); return; }
    setBusy(true);
    try {
      await verifyResetCode(email.trim(), code.trim());
      setStep("password");
      setPassword("");
      setConfirm("");
    } catch (err) {
      if (!rateLimited(err, setVerifyIn)) {
        setError(message(err));
        setDigits(emptyDigits());
        window.setTimeout(() => cardRef.current?.querySelector<HTMLElement>("#code")?.focus(), 0);
      }
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(""); setNotice(""); setLimitNote("");
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 12 || password.length > 128) {
      setError("Passwords must be 12 to 128 characters.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(email.trim(), code.trim(), password);
      setStep("done");
    } catch (err) {
      if (!rateLimited(err, setVerifyIn)) setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const lengthOk = password.length >= 12 && password.length <= 128;
  const meter = strength(password);
  const matches = confirm.length > 0 && password === confirm;
  const resendButton = (label: string) => (
    <button type="button" className="rc-link" disabled={busy || resendIn > 0} onClick={() => void requestCode()}>
      {resendIn > 0 ? <>{label} in <span className="rc-countdown">{Math.floor(resendIn / 60)}:{String(resendIn % 60).padStart(2, "0")}</span></> : label}
    </button>
  );

  return (
    <div className="lp rc-page" data-theme={theme}>
      <SiteNav theme={theme} onToggleTheme={toggleTheme} />
      {notices && <div className="lp-notices">{notices}</div>}

      <main id="main-content" tabIndex={-1} className="rc-main">
        <div className="rc-card" ref={cardRef}>
          <p className="visually-hidden" role="status" aria-live="polite">{limitNote}</p>
          <StepIndicator step={step} />

          <div key={step} className="rc-panel">
            {step === "email" && (
              <>
                <span className="rc-badge"><IconMail /></span>
                <h1>Reset your password</h1>
                <p className="rc-lead">Enter your account email and we'll send you a 6-digit code.</p>
                <form onSubmit={requestCode} noValidate>
                  <label className="field-label" htmlFor="email">Email</label>
                  <input
                    id="email"
                    className="rc-input"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                    aria-invalid={!!error || undefined}
                    aria-describedby={error ? "email-hint rc-error" : "email-hint"}
                  />
                  <p id="email-hint" className="rc-hint">Use the email you signed up with, like name@example.com.</p>
                  {error && <ErrorMessage id="rc-error">{error}</ErrorMessage>}
                  <SubmitButton busy={busy} disabled={resendIn > 0} busyLabel="Sending code…">{resendIn > 0 ? `Try again in ${resendIn}s` : 'Send reset code'}</SubmitButton>
                  <p className="rc-fine">The code expires 5 minutes after it's sent.</p>
                </form>
              </>
            )}

            {step === "code" && (
              <>
                <span className="rc-badge"><IconKey /></span>
                <h1>Check your email</h1>
                <p className="rc-lead">
                  If an account exists for <strong className="rc-email">{email}</strong>, we've sent a 6-digit code.
                  It expires in 5 minutes. Check your spam folder too.
                </p>
                <form onSubmit={verify} noValidate>
                  <CodeBoxes digits={digits} onChange={setDigits} disabled={busy} invalid={!!error} describedBy={error ? "rc-error" : undefined} />
                  {error && <ErrorMessage id="rc-error">{error}</ErrorMessage>}
                  {notice && <p role="status" className="rc-alert rc-alert-info"><IconInfo /><span>{notice}</span></p>}
                  <SubmitButton busy={busy} disabled={verifyIn > 0} busyLabel="Checking code…">{verifyIn > 0 ? `Try again in ${verifyIn}s` : 'Verify code'}</SubmitButton>
                </form>
                <div className="rc-row rc-row-stack">
                  <p className="rc-row"><span>Didn't get it?</span> {resendButton("Resend code")}</p>
                  <button type="button" className="rc-link" disabled={busy} onClick={() => { setStep("email"); setError(""); setNotice(""); setLimitNote(""); setResendIn(0); setVerifyIn(0); }}>
                    Use a different email
                  </button>
                </div>
              </>
            )}

            {step === "password" && (
              <>
                <span className="rc-badge"><IconLock /></span>
                <h1>Create a new password</h1>
                <p className="rc-lead">Choose a password you don't use anywhere else. You'll be logged out of your other devices.</p>
                <form onSubmit={save} noValidate className="rc-password">
                  <PasswordInput id="new-password" label="New password" value={password} onChange={setPassword} disabled={busy}
                    autoComplete="new-password" describedBy="pw-strength pw-reqs" />
                  <div id="pw-strength" className="rc-meter-wrap" aria-live="polite">
                    <div className={`rc-meter s-${meter.score}`} aria-hidden="true"><span /><span /><span /><span /></div>
                    <p className="rc-meter-label">{meter.label ? <>Strength: <strong>{meter.label}</strong></> : "Strength appears as you type."}</p>
                  </div>
                  <ul id="pw-reqs" className="rc-reqs" aria-label="Password requirements">
                    <Requirement met={lengthOk} pending={!password}>12 to 128 characters</Requirement>
                  </ul>
                  <PasswordInput id="confirm-password" label="Confirm password" value={confirm} onChange={setConfirm} disabled={busy}
                    autoComplete="new-password" describedBy="pw-match" />
                  <ul id="pw-match" className="rc-reqs" aria-live="polite">
                    <Requirement met={matches} pending={!confirm}>{confirm && !matches ? "Passwords don't match yet" : "Passwords match"}</Requirement>
                  </ul>
                  {error && <ErrorMessage id="rc-error">{error}</ErrorMessage>}
                  <SubmitButton busy={busy} disabled={verifyIn > 0} busyLabel="Saving…">{verifyIn > 0 ? `Try again in ${verifyIn}s` : 'Reset password'}</SubmitButton>
                </form>
                <div className="rc-row"><span>Code expired?</span> {resendButton("Request a new code")}</div>
              </>
            )}

            {step === "done" && (
              <div className="rc-done">
                <span className="rc-badge rc-badge-success"><IconCheck size={30} /></span>
                <h1 tabIndex={-1}>Password updated</h1>
                <p className="rc-lead" role="status">Your password was reset. You can now log in with your new password. Taking you to log in…</p>
                <Link to={LOGIN_HREF} className="lp-btn lp-btn-primary lp-btn-lg rc-submit">Log in</Link>
              </div>
            )}
          </div>

          {step !== "done" && (
            <Link to={LOGIN_HREF} className="rc-back"><IconBack />Back to log in</Link>
          )}
        </div>
      </main>
    </div>
  );
}

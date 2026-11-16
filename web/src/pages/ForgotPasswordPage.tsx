import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { forgotPassword, resetPassword, verifyResetCode } from "../api";
import { PasswordInput } from "../components/PasswordInput";

type Step = "email" | "code" | "password" | "done";

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Unable to reach the server.";
}

export function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const nav = useNavigate();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step !== "done") return;
    const t = window.setTimeout(() => nav("/"), 3000);
    return () => window.clearTimeout(t);
  }, [step, nav]);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    if (!email.trim()) { setError("Enter your account email."); return; }
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setStep("code");
      setCode("");
      setResendIn(60);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!/^\d{6}$/.test(code.trim())) { setError("Enter the 6-digit code."); return; }
    setBusy(true);
    try {
      await verifyResetCode(email.trim(), code.trim());
      setStep("password");
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
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
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card auth-card">
      {step === "email" && (
        <>
          <h1>Reset your password</h1>
          <p className="muted">
            Enter your account email and we'll send you a 6-digit code.
          </p>
          <form onSubmit={requestCode} noValidate>
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            {error && (
              <p role="alert" className="error-box">
                {error}
              </p>
            )}
            <button className="btn-primary" disabled={busy}>
              {busy ? "Sending…" : "Send reset code"}
            </button>
          </form>
        </>
      )}

      {step === "code" && (
        <>
          <h1>Check your email</h1>
          <p className="muted">
            If an account exists for {email}, we sent a 6-digit code. It
            expires in 5 minutes.
          </p>
          <form onSubmit={verify} noValidate>
            <label className="field-label" htmlFor="code">
              Verification code
            </label>
            <input
              id="code"
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              disabled={busy}
            />
            {error && (
              <p role="alert" className="error-box">
                {error}
              </p>
            )}
            <button className="btn-primary" disabled={busy}>
              {busy ? "Verifying…" : "Verify code"}
            </button>
          </form>
          <p className="hint">
            Didn't get it? Check spam, or{" "}
            <button
              className="link-btn"
              disabled={busy || resendIn > 0}
              onClick={() => void requestCode()}
            >
              {resendIn > 0 ? `resend in ${resendIn}s` : "resend the code"}
            </button>
            {" · "}
            <button
              className="link-btn"
              disabled={busy}
              onClick={() => {
                setStep("email");
                setError("");
              }}
            >
              use a different email
            </button>
          </p>
        </>
      )}

      {step === "password" && (
        <>
          <h1>Create a new password</h1>
          <form onSubmit={save} noValidate>
            <PasswordInput
              id="new-password"
              label="New password"
              value={password}
              onChange={setPassword}
              disabled={busy}
              autoComplete="new-password"
            />
            <PasswordInput
              id="confirm-password"
              label="Confirm password"
              value={confirm}
              onChange={setConfirm}
              disabled={busy}
              autoComplete="new-password"
            />
            <p className="hint">Use 12 to 128 characters.</p>
            {error && (
              <p role="alert" className="error-box">
                {error}
              </p>
            )}
            <button className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Reset password"}
            </button>
          </form>
        </>
      )}

      {step === "done" && (
        <>
          <h1>Password updated</h1>
          <p className="muted">
            Your password was reset. Redirecting to login…
          </p>
          <Link className="link-btn auth-toggle" to="/">
            Back to log in
          </Link>
        </>
      )}

      {step !== "done" && (
        <Link className="link-btn auth-toggle" to="/">
          Back to log in
        </Link>
      )}
    </section>
  );
}

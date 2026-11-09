import { useState, type FormEvent } from "react";
import { authenticate, type User } from "../api";

export function AuthPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [action, setAction] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try { onLogin((await authenticate(action, email, password)).user); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to reach the server."); }
    finally { setBusy(false); }
  }
  return <section className="card auth-card">
    <h1>{action === "login" ? "Welcome to SafeText" : "Create your account"}</h1>
    <p className="muted">Check messages and keep your scan history private.</p>
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
      <label className="field-label" htmlFor="password">Password</label>
      <div className="password-field">
        <input id="password" type={showPassword ? "text" : "password"} autoComplete={action === "login" ? "current-password" : "new-password"} minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
        <button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} aria-controls="password" disabled={busy} onClick={() => setShowPassword(value => !value)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {showPassword && <path d="m3 3 18 18" />}
          </svg>
        </button>
      </div>
      <p className="hint">Use 12 to 128 characters.</p>
      {error && <p role="alert" className="error-box">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Please wait..." : action === "login" ? "Log in" : "Create account"}</button>
    </form>
    <button className="link-btn auth-toggle" disabled={busy} onClick={() => { setAction(action === "login" ? "register" : "login"); setError(""); setPassword(""); setShowPassword(false); }}>
      {action === "login" ? "New here? Create an account" : "Already have an account? Log in"}
    </button>
  </section>;
}

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { authenticate, type User } from "../api";
import { PasswordInput } from "../components/PasswordInput";

export function AuthPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [action, setAction] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      <PasswordInput id="password" label="Password" value={password} onChange={setPassword} disabled={busy} autoComplete={action === "login" ? "current-password" : "new-password"} />
      <p className="hint">Use 12 to 128 characters.</p>
      {action === "login" && <p className="forgot-row"><Link to="/forgot-password">Forgot password?</Link></p>}
      {error && <p role="alert" className="error-box">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Please wait..." : action === "login" ? "Log in" : "Create account"}</button>
    </form>
    <button className="link-btn auth-toggle" disabled={busy} onClick={() => { setAction(action === "login" ? "register" : "login"); setError(""); setPassword(""); }}>
      {action === "login" ? "New here? Create an account" : "Already have an account? Log in"}
    </button>
  </section>;
}

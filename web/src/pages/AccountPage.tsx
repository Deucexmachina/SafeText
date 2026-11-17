import { useEffect, useState, type FormEvent } from "react";
import { ApiError, changePassword, listSessions, revokeSession, type SessionInfo } from "../api";
import { PasswordInput } from "../components/PasswordInput";
import { svgIcon } from "../components/SiteNav";

const IconDevice = () => svgIcon(20, <><rect x="4" y="3" width="16" height="12" rx="1.5" /><path d="M2 19h20M9 15v4h6v-4" /></>);

function fmt(date: string | null) {
  return date ? new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Earlier sign-in";
}

export function AccountPage() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [sessionsError, setSessionsError] = useState("");
  const [revoking, setRevoking] = useState("");

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwDone, setPwDone] = useState(false);

  useEffect(() => {
    listSessions()
      .then(r => setSessions(r.sessions))
      .catch(err => setSessionsError(err instanceof ApiError ? err.detail : "Could not load your sessions."));
  }, []);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (pwBusy) return;
    if (next !== confirm) { setPwError("New passwords don't match."); setPwDone(false); return; }
    setPwBusy(true); setPwError(""); setPwDone(false);
    try {
      await changePassword(current, next);
      setPwDone(true); setCurrent(""); setNext(""); setConfirm("");
    } catch (err) {
      setPwError(err instanceof ApiError ? err.detail : "Could not change your password. Please try again.");
    } finally { setPwBusy(false); }
  }

  async function revoke(id: string) {
    if (revoking) return;
    setRevoking(id); setSessionsError("");
    try {
      await revokeSession(id);
      setSessions(list => list?.filter(s => s.id !== id) ?? null);
    } catch (err) {
      setSessionsError(err instanceof ApiError ? err.detail : "Could not sign out that device.");
    } finally { setRevoking(""); }
  }

  return (
    <div className="ap-page ap-account">
      <header className="ap-page-head">
        <h1>Account</h1>
        <p className="ap-lead">Your password and the devices signed in to SafeText.</p>
      </header>

      <section className="ap-card" aria-labelledby="pw-title">
        <h2 id="pw-title" className="ap-label">Change password</h2>
        <form onSubmit={submitPassword} noValidate>
          <PasswordInput id="pw-current" label="Current password" value={current} onChange={setCurrent}
            disabled={pwBusy} autoComplete="current-password" />
          <PasswordInput id="pw-new" label="New password" value={next} onChange={setNext}
            disabled={pwBusy} autoComplete="new-password" />
          <PasswordInput id="pw-confirm" label="Confirm new password" value={confirm} onChange={setConfirm}
            disabled={pwBusy} autoComplete="new-password" />
          <p className="ap-hint">Use 12 to 128 characters. Your other devices stay signed in — sign them out below.</p>
          {pwError && <p role="alert" className="ap-alert ap-alert-error"><span>{pwError}</span></p>}
          {pwDone && <p role="status" className="ap-alert ap-alert-info"><span>Password updated.</span></p>}
          <button type="submit" className="lp-btn lp-btn-primary" disabled={pwBusy || !current || !next || !confirm}>
            {pwBusy ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      <section className="ap-card" aria-labelledby="devices-title">
        <h2 id="devices-title" className="ap-label">Signed-in devices</h2>
        <p className="ap-muted">Up to five devices stay signed in. Sign out any you don't recognize.</p>
        {sessionsError && <p role="alert" className="ap-alert ap-alert-error"><span>{sessionsError}</span></p>}
        {!sessions && !sessionsError && <p role="status" className="ap-muted">Loading devices…</p>}
        {sessions && sessions.length === 0 && <p className="ap-muted">No active sessions.</p>}
        {sessions && sessions.length > 0 && (
          <ul className="ap-sessions">
            {sessions.map(s => (
              <li key={s.id} className="ap-session">
                <span className="ap-session-icon" aria-hidden="true"><IconDevice /></span>
                <span className="ap-session-info">
                  <strong>{s.device}</strong>
                  <span className="ap-muted">Signed in {fmt(s.signedInAt)}</span>
                </span>
                {s.current
                  ? <span className="ap-badge-current">This device</span>
                  : <button type="button" className="lp-btn lp-btn-secondary ap-session-btn" disabled={!!revoking}
                      onClick={() => void revoke(s.id)}>
                      {revoking === s.id ? "Signing out…" : "Sign out"}
                    </button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

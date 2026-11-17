import { useEffect, useState, type FormEvent } from "react";
import { forceLogoutUser, listUsers, setUserDisabled, type AdminUser, type UserFilter } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { DatePicker } from "../../components/DatePicker";
import { Empty, ErrorAlert, Icons, Loading, Pager, Section, ago, fmt } from "./ui";

const EMPTY_FILTER: UserFilter = { search: "", status: "", from: "", to: "" };
// en-CA renders YYYY-MM-DD in local time, which is what input[type=date] expects.
const today = new Date().toLocaleDateString("en-CA");
const STATUS_OPTIONS: { value: UserFilter["status"]; label: string }[] = [
  { value: "", label: "All" }, { value: "active", label: "Active" }, { value: "disabled", label: "Disabled" },
];

function Signal({ value, threshold, title }: { value: number; threshold: number; title: string }) {
  if (value < threshold) return <span className="ad-num">{value}</span>;
  return <span className="ad-chip-warn" title={title}>{Icons.alert(13)}{value}</span>;
}

function StatusPill({ user }: { user: AdminUser }) {
  return user.disabled
    ? <span className="ad-pill is-bad">{Icons.lock()}Disabled</span>
    : <span className="ad-pill is-ok">{Icons.check(14)}Active</span>;
}

export function Accounts() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<UserFilter>(EMPTY_FILTER);
  const [filter, setFilter] = useState<UserFilter>(EMPTY_FILTER);
  const [pendingUser, setPendingUser] = useState<AdminUser | null>(null);
  const [pendingLogout, setPendingLogout] = useState<AdminUser | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    listUsers(offset, filter).then(result => { if (!cancelled) setUsers(result.users); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load accounts."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offset, filter]);

  function applyFilter(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setFilter({ ...draft, search: draft.search.trim() });
  }

  function clearFilter() { setDraft(EMPTY_FILTER); setFilter(EMPTY_FILTER); setOffset(0); }

  async function toggle(user: AdminUser, password: string, reason: string) {
    if (busy) return;
    setBusy(true); setDialogError("");
    try {
      await setUserDisabled(user.id, !user.disabled, { password, reason });
      setUsers(current => current.map(item => item.id === user.id
        ? { ...item, disabled: !item.disabled, disabledReason: !item.disabled ? reason : null } : item));
      setPendingUser(null);
      setNotice(`${user.email} was ${user.disabled ? "enabled" : "disabled"}.`);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Could not update the account.");
    } finally { setBusy(false); }
  }

  async function forceLogout(user: AdminUser, reason: string) {
    if (busy) return;
    setBusy(true); setDialogError("");
    try {
      await forceLogoutUser(user.id, reason);
      setPendingLogout(null);
      setNotice(`${user.email} was logged out of every device.`);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Could not end the sessions.");
    } finally { setBusy(false); }
  }

  const filtered = filter.search || filter.status || filter.from || filter.to;
  const actions = (user: AdminUser) => user.role === "admin"
    ? <span className="ad-pill is-muted">Administrator</span>
    : <div className="ad-row-actions">
        <button type="button" className={`ad-btn${user.disabled ? "" : " ad-btn-danger"}`} disabled={busy}
          onClick={() => { setPendingUser(user); setDialogError(""); setNotice(""); }}>
          {user.disabled ? Icons.unlock() : Icons.lock()}{user.disabled ? "Enable" : "Disable"}
        </button>
        <button type="button" className="ad-btn" disabled={busy}
          onClick={() => { setPendingLogout(user); setDialogError(""); setNotice(""); }}>
          {Icons.logout()}Log out
        </button>
      </div>;

  return (
    <Section title="Accounts" description="Manage account access. Each person's messages and scan history remain private.">
      {pendingUser && <ConfirmDialog
        title={pendingUser.disabled ? "Enable this account?" : "Disable this account?"}
        message={pendingUser.disabled
          ? `${pendingUser.email} will be able to sign in again. Their scan history will be preserved.`
          : `${pendingUser.email} will be logged out and unable to sign in until you enable their account again. Their scan history will be preserved.`}
        confirmLabel={pendingUser.disabled ? "Enable account" : "Disable account"}
        busyLabel={pendingUser.disabled ? "Enabling..." : "Disabling..."} busy={busy}
        danger={!pendingUser.disabled}
        reason password reasonRequired={!pendingUser.disabled}
        reasonHint={pendingUser.disabled ? "Recorded in the audit log." : "Shown to the user when they try to log in, and recorded in the audit log."}
        error={dialogError}
        onCancel={() => { setPendingUser(null); setDialogError(""); }}
        onConfirm={values => void toggle(pendingUser, values.password, values.reason)}
      />}
      {pendingLogout && <ConfirmDialog
        title="Log this account out?"
        message={`Every active session for ${pendingLogout.email} will be ended. The account stays enabled and can sign in again.`}
        confirmLabel="Force logout" busyLabel="Logging out..." busy={busy}
        reason reasonRequired={false} reasonHint="Recorded in the audit log."
        error={dialogError}
        onCancel={() => { setPendingLogout(null); setDialogError(""); }}
        onConfirm={values => void forceLogout(pendingLogout, values.reason)}
      />}

      <form className="ap-card ad-filters" onSubmit={applyFilter}>
        <div className="ap-search ad-filter-search">
          <label htmlFor="acct-search" className="visually-hidden">Search by email</label>
          {Icons.search()}
          <input id="acct-search" type="search" placeholder="Search email" value={draft.search} onChange={e => setDraft({ ...draft, search: e.target.value })} />
        </div>
        <div className="ad-filter-status" role="group" aria-label="Filter by status">
          {STATUS_OPTIONS.map(o => (
            <button key={o.value || "all"} type="button" className="ap-filter" aria-pressed={draft.status === o.value}
              onClick={() => setDraft({ ...draft, status: o.value })}>{o.label}</button>
          ))}
        </div>
        <div className="ad-filter-dates">
          <div className="ad-date-field">
            <label htmlFor="joined-from">Joined from</label>
            <DatePicker id="joined-from" value={draft.from} max={draft.to || today} placeholder="Any date"
              onChange={from => setDraft({ ...draft, from })} />
          </div>
          <div className="ad-date-field dp-align-end">
            <label htmlFor="joined-to">to</label>
            <DatePicker id="joined-to" value={draft.to} min={draft.from || undefined} max={today} placeholder="Any date"
              onChange={to => setDraft({ ...draft, to })} />
          </div>
        </div>
        <div className="ad-filter-buttons">
          <button className="lp-btn lp-btn-primary lp-btn-sm" type="submit" disabled={loading}>Apply</button>
          <button className="lp-btn lp-btn-secondary lp-btn-sm" type="button" disabled={loading} onClick={clearFilter}>Clear</button>
        </div>
      </form>

      {error && <ErrorAlert>{error}</ErrorAlert>}
      {notice && <p className="ap-alert ap-alert-info" role="status">{Icons.check()}<span>{notice}</span></p>}
      <div className="ap-card ad-table-card">
        {loading ? <Loading label="Loading accounts..." /> : !users.length ? (
          <Empty title={filtered ? "No accounts match" : "No accounts yet"}>{filtered ? "Try a different email, status or date range." : undefined}</Empty>
        ) : <>
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr>
                <th scope="col">Account</th><th scope="col">Status</th><th scope="col">Scans</th>
                <th scope="col">Warnings</th><th scope="col">Last active</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr></thead>
              <tbody>{users.map(user => (
                <tr key={user.id}>
                  <td>
                    <div className="ad-account">
                      <span className="ad-avatar" aria-hidden="true">{user.email.charAt(0).toUpperCase()}</span>
                      <div>
                        <div className="ad-email">{user.email}{user.role === "admin" && <span className="ad-role">Admin</span>}</div>
                        <div className="ap-muted ad-sub" title={fmt(user.createdAt)}>Joined {ago(user.createdAt)}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusPill user={user} />
                    {user.disabled && user.disabledReason && <div className="ad-reason" title={user.disabledReason}>{user.disabledReason}</div>}
                  </td>
                  <td className="ad-num">{user.scanCount}</td>
                  <td>
                    <div className="ad-warnings">
                      <span><span className="ad-warn-label">Failed logins</span><Signal value={user.failedLogins} threshold={5} title={`${user.failedLogins} failed login attempts`} /></span>
                      <span><span className="ad-warn-label">Rate hits</span><Signal value={user.rateLimitHits ?? user.scanRateHits} threshold={3} title={`Scans: ${user.scanRateHits}; login/registration: ${user.authRateHits ?? 0}; reset: ${user.resetRateHits ?? 0}; general API: ${user.apiRateHits ?? 0}. Email-targeted requests may come from someone else.`} /></span>
                    </div>
                  </td>
                  <td>
                    <div title={fmt(user.lastActiveAt)}>{ago(user.lastActiveAt)}</div>
                    <div className="ap-muted ad-sub" title={fmt(user.lastLoginAt)}>Login {ago(user.lastLoginAt).toLowerCase()}</div>
                  </td>
                  <td className="ad-actions-cell">{actions(user)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <ul className="ad-cards">
            {users.map(user => (
              <li key={user.id} className="ad-card">
                <div className="ad-account">
                  <span className="ad-avatar" aria-hidden="true">{user.email.charAt(0).toUpperCase()}</span>
                  <div>
                    <div className="ad-email">{user.email}{user.role === "admin" && <span className="ad-role">Admin</span>}</div>
                    <div className="ap-muted ad-sub">Joined {ago(user.createdAt)}</div>
                  </div>
                </div>
                <div><StatusPill user={user} />{user.disabled && user.disabledReason && <div className="ad-reason">{user.disabledReason}</div>}</div>
                <dl className="ad-facts">
                  <div><dt>Scans</dt><dd className="ad-num">{user.scanCount}</dd></div>
                  <div><dt>Failed logins</dt><dd><Signal value={user.failedLogins} threshold={5} title={`${user.failedLogins} failed login attempts`} /></dd></div>
                  <div><dt>Rate hits</dt><dd><Signal value={user.rateLimitHits ?? user.scanRateHits} threshold={3} title={`Scans: ${user.scanRateHits}; login/registration: ${user.authRateHits ?? 0}; reset: ${user.resetRateHits ?? 0}; general API: ${user.apiRateHits ?? 0}. Email-targeted requests may come from someone else.`} /></dd></div>
                  <div><dt>Last active</dt><dd>{ago(user.lastActiveAt)}</dd></div>
                  <div><dt>Last login</dt><dd>{ago(user.lastLoginAt)}</dd></div>
                </dl>
                {actions(user)}
              </li>
            ))}
          </ul>
        </>}
        <Pager offset={offset} count={users.length} disabled={loading || busy} onPage={setOffset} label="Account pages" />
      </div>
    </Section>
  );
}

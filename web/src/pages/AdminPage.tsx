import { useEffect, useState, type FormEvent } from 'react';
import { downloadAuditCsv, forceLogoutUser, listAudit, listUsers, setUserDisabled, type AdminUser, type AuditEntry, type UserFilter } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

const PAGE = 20;
const EMPTY_FILTER: UserFilter = { search: '', status: '', from: '', to: '' };
// en-CA renders YYYY-MM-DD in local time, which is what input[type=date] expects.
const today = new Date().toLocaleDateString('en-CA');

const ACTION_LABELS: Record<string, string> = {
  disable_user: 'Disabled account',
  enable_user: 'Enabled account',
  force_logout: 'Forced logout',
};

function fmt(date: string | null) {
  return date ? new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function AdminPage() {
  const [view, setView] = useState<'accounts' | 'audit'>('accounts');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<UserFilter>(EMPTY_FILTER);
  const [filter, setFilter] = useState<UserFilter>(EMPTY_FILTER);
  const [pendingUser, setPendingUser] = useState<AdminUser | null>(null);
  const [pendingLogout, setPendingLogout] = useState<AdminUser | null>(null);
  const [dialogError, setDialogError] = useState('');

  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState('');

  useEffect(() => {
    if (view !== 'accounts') return;
    let cancelled = false; setLoading(true); setError('');
    listUsers(offset, filter).then(result => { if (!cancelled) setUsers(result.users); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load accounts.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offset, filter, view]);

  useEffect(() => {
    if (view !== 'audit') return;
    let cancelled = false; setAuditLoading(true); setAuditError('');
    listAudit(auditOffset).then(result => { if (!cancelled) setAudit(result.audit); })
      .catch(err => { if (!cancelled) setAuditError(err instanceof Error ? err.message : 'Could not load the audit log.'); })
      .finally(() => { if (!cancelled) setAuditLoading(false); });
    return () => { cancelled = true; };
  }, [auditOffset, view]);

  function applyFilter(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setFilter({ ...draft, search: draft.search.trim() });
  }

  async function toggle(user: AdminUser, password: string, reason: string) {
    if (busy) return;
    setBusy(true); setDialogError('');
    try {
      await setUserDisabled(user.id, !user.disabled, { password, reason });
      setUsers(current => current.map(item => item.id === user.id
        ? { ...item, disabled: !item.disabled, disabledReason: !item.disabled ? reason : null } : item));
      setPendingUser(null);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Could not update the account.');
    } finally { setBusy(false); }
  }

  async function forceLogout(user: AdminUser) {
    if (busy) return;
    setBusy(true); setDialogError('');
    try {
      await forceLogoutUser(user.id);
      setPendingLogout(null);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Could not end the sessions.');
    } finally { setBusy(false); }
  }

  return <section className="card">
    <h1>Account management</h1>
    <p className="muted">Manage account access. Each person's messages and scan history remain private.</p>
    <div className="admin-tabs" role="tablist">
      <button role="tab" aria-selected={view === 'accounts'} className={view === 'accounts' ? 'admin-tab active' : 'admin-tab'}
        onClick={() => setView('accounts')}>Accounts</button>
      <button role="tab" aria-selected={view === 'audit'} className={view === 'audit' ? 'admin-tab active' : 'admin-tab'}
        onClick={() => setView('audit')}>Audit log</button>
    </div>

    {view === 'accounts' && <>
      {pendingUser && <ConfirmDialog
        title={pendingUser.disabled ? 'Enable this account?' : 'Disable this account?'}
        message={pendingUser.disabled
          ? `${pendingUser.email} will be able to sign in again. Their scan history will be preserved.`
          : `${pendingUser.email} will be logged out and unable to sign in until you enable their account again. Their scan history will be preserved.`}
        confirmLabel={pendingUser.disabled ? 'Enable account' : 'Disable account'}
        busyLabel={pendingUser.disabled ? 'Enabling...' : 'Disabling...'} busy={busy}
        danger={!pendingUser.disabled}
        reason={!pendingUser.disabled} password
        error={dialogError}
        onCancel={() => { setPendingUser(null); setDialogError(''); }}
        onConfirm={values => void toggle(pendingUser, values.password, values.reason)}
      />}
      {pendingLogout && <ConfirmDialog
        title="Log this account out?"
        message={`Every active session for ${pendingLogout.email} will be ended. The account stays enabled and can sign in again.`}
        confirmLabel="Force logout" busyLabel="Logging out..." busy={busy}
        error={dialogError}
        onCancel={() => { setPendingLogout(null); setDialogError(''); }}
        onConfirm={() => void forceLogout(pendingLogout)}
      />}

      <form className="admin-filters" onSubmit={applyFilter}>
        <input type="search" placeholder="Search email" aria-label="Search by email"
          value={draft.search} onChange={e => setDraft({ ...draft, search: e.target.value })} />
        <select aria-label="Filter by status" value={draft.status}
          onChange={e => setDraft({ ...draft, status: e.target.value as UserFilter['status'] })}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
        <label className="filter-date">Joined from
          <input type="date" min={today} value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label className="filter-date">to
          <input type="date" min={draft.from || today} value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <button className="page-btn" type="submit" disabled={loading}>Apply</button>
        <button className="page-btn" type="button" disabled={loading}
          onClick={() => { setDraft(EMPTY_FILTER); setFilter(EMPTY_FILTER); setOffset(0); }}>Clear</button>
      </form>

      {error && <p role="alert" className="error-box">{error}</p>}
      {loading ? <p role="status">Loading accounts...</p> : <div className="admin-table-wrap"><table className="history-table">
        <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Scans</th><th>Failed logins</th><th>Rate hits</th><th>Last login</th><th>Last active</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>{users.map(user => <tr key={user.id}>
          <td>{user.email}</td>
          <td>{user.role}</td>
          <td>{user.disabled ? <span className="signal-bad">Disabled</span> : 'Active'}
            {user.disabled && user.disabledReason && <span className="status-note" title={user.disabledReason}>{user.disabledReason}</span>}</td>
          <td>{user.scanCount}</td>
          <td>{user.failedLogins >= 5 ? <span className="signal-warn" title={`${user.failedLogins} failed login attempts`}>{user.failedLogins}</span> : user.failedLogins}</td>
          <td>{user.scanRateHits >= 3 ? <span className="signal-warn" title={`${user.scanRateHits} scan rate-limit hits`}>{user.scanRateHits}</span> : user.scanRateHits}</td>
          <td className="nowrap">{fmt(user.lastLoginAt)}</td>
          <td className="nowrap">{fmt(user.lastActiveAt)}</td>
          <td className="nowrap">{fmt(user.createdAt)}</td>
          <td className="nowrap">{user.role === 'admin' ? 'Administrator' : <>
            <button className="page-btn" disabled={busy} onClick={() => { setPendingUser(user); setDialogError(''); }}>
              {user.disabled ? 'Enable' : 'Disable'}</button>
            <button className="page-btn" disabled={busy} onClick={() => { setPendingLogout(user); setDialogError(''); }}>Log out</button>
          </>}</td>
        </tr>)}</tbody>
      </table>{!users.length && <p>No accounts match.</p>}</div>}
      <div className="pagination"><button className="page-btn" disabled={loading || busy || offset === 0} onClick={() => setOffset(offset - PAGE)}>Previous</button>
        <button className="page-btn" disabled={loading || busy || users.length < PAGE} onClick={() => setOffset(offset + PAGE)}>Next</button></div>
    </>}

    {view === 'audit' && <>
      <div className="audit-toolbar">
        <p className="muted">Every admin action is recorded here.</p>
        <button className="page-btn" onClick={() => void downloadAuditCsv().catch(err => setAuditError(err instanceof Error ? err.message : 'Could not export the audit log.'))}>Export CSV</button>
      </div>
      {auditError && <p role="alert" className="error-box">{auditError}</p>}
      {auditLoading ? <p role="status">Loading audit log...</p> : <div className="admin-table-wrap"><table className="history-table">
        <thead><tr><th>Time</th><th>Actor</th><th>Target</th><th>Action</th><th>Reason</th></tr></thead>
        <tbody>{audit.map(entry => <tr key={entry.id}>
          <td className="nowrap">{fmt(entry.createdAt)}</td>
          <td>{entry.actorEmail}</td>
          <td>{entry.targetEmail}</td>
          <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
          <td>{entry.reason ?? '—'}</td>
        </tr>)}</tbody>
      </table>{!audit.length && <p>No admin actions yet.</p>}</div>}
      <div className="pagination"><button className="page-btn" disabled={auditLoading || auditOffset === 0} onClick={() => setAuditOffset(auditOffset - PAGE)}>Previous</button>
        <button className="page-btn" disabled={auditLoading || audit.length < PAGE} onClick={() => setAuditOffset(auditOffset + PAGE)}>Next</button></div>
    </>}
  </section>;
}

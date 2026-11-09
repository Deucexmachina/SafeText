import { useEffect, useState } from 'react';
import { listUsers, setUserDisabled, type AdminUser } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingUser, setPendingUser] = useState<AdminUser | null>(null);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    listUsers(offset).then(result => { if (!cancelled) setUsers(result.users); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load accounts.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offset]);
  async function toggle(user: AdminUser) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await setUserDisabled(user.id, !user.disabled);
      setUsers(current => current.map(item => item.id === user.id ? { ...item, disabled: !item.disabled } : item));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update the account.'); }
    finally { setBusy(false); setPendingUser(null); }
  }
  return <section className="card">
    {pendingUser && <ConfirmDialog
      title={pendingUser.disabled ? 'Enable this account?' : 'Disable this account?'}
      message={pendingUser.disabled
        ? `${pendingUser.email} will be able to sign in again. Their scan history will be preserved.`
        : `${pendingUser.email} will be logged out and unable to sign in until you enable their account again. Their scan history will be preserved.`}
      confirmLabel={pendingUser.disabled ? 'Enable account' : 'Disable account'}
      busyLabel={pendingUser.disabled ? 'Enabling...' : 'Disabling...'} busy={busy}
      onCancel={() => setPendingUser(null)} onConfirm={() => void toggle(pendingUser)}
    />}
    <h1>Account management</h1>
    <p className="muted">Manage account access. Each person's messages and scan history remain private.</p>
    {error && <p role="alert" className="error-box">{error}</p>}
    {loading ? <p role="status">Loading accounts...</p> : <div className="admin-table-wrap"><table className="history-table">
      <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Scans</th><th>Access</th></tr></thead>
      <tbody>{users.map(user => <tr key={user.id}>
        <td>{user.email}</td><td>{user.role}</td><td>{user.disabled ? 'Disabled' : 'Active'}</td><td>{user.scanCount}</td>
        <td>{user.role === 'admin' ? 'Administrator' : <button className="page-btn" disabled={busy} onClick={() => setPendingUser(user)}>{user.disabled ? 'Enable' : 'Disable'}</button>}</td>
      </tr>)}</tbody>
    </table>{!users.length && <p>No accounts on this page.</p>}</div>}
    <div className="pagination"><button className="page-btn" disabled={loading || busy || offset === 0} onClick={() => setOffset(offset - 20)}>Previous</button>
      <button className="page-btn" disabled={loading || busy || users.length < 20} onClick={() => setOffset(offset + 20)}>Next</button></div>
  </section>;
}

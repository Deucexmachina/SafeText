import { useEffect, useState } from 'react';
import { listUsers, setUserDisabled, type AdminUser } from '../api';

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    listUsers(offset).then(result => { if (!cancelled) setUsers(result.users); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load accounts.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offset]);
  async function toggle(user: AdminUser) {
    if (!window.confirm(`${user.disabled ? 'Enable' : 'Disable'} this account? ${user.disabled ? 'The user will need to log in again.' : 'The user will be logged out and unable to sign in.'}`)) return;
    setBusy(true); setError('');
    try {
      await setUserDisabled(user.id, !user.disabled);
      setUsers(current => current.map(item => item.id === user.id ? { ...item, disabled: !item.disabled } : item));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update the account.'); }
    finally { setBusy(false); }
  }
  return <section className="card">
    <h1>Account management</h1>
    <p className="muted">Manage account access. Each person's messages and scan history remain private.</p>
    {error && <p role="alert" className="error-box">{error}</p>}
    {loading ? <p role="status">Loading accounts...</p> : <div className="admin-table-wrap"><table className="history-table">
      <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Scans</th><th>Access</th></tr></thead>
      <tbody>{users.map(user => <tr key={user.id}>
        <td>{user.email}</td><td>{user.role}</td><td>{user.disabled ? 'Disabled' : 'Active'}</td><td>{user.scanCount}</td>
        <td>{user.role === 'admin' ? 'Administrator' : <button className="page-btn" disabled={busy} onClick={() => void toggle(user)}>{user.disabled ? 'Enable' : 'Disable'}</button>}</td>
      </tr>)}</tbody>
    </table>{!users.length && <p>No accounts on this page.</p>}</div>}
    <div className="pagination"><button className="page-btn" disabled={loading || busy || offset === 0} onClick={() => setOffset(offset - 20)}>Previous</button>
      <button className="page-btn" disabled={loading || busy || users.length < 20} onClick={() => setOffset(offset + 20)}>Next</button></div>
  </section>;
}

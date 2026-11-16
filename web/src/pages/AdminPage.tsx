import { useEffect, useState, type FormEvent } from 'react';
import { addDomain, downloadAuditCsv, forceLogoutUser, getAdminOverview, getAdminSettings, listAudit, listDomains, listReports, listUsers, removeDomain, saveAdminSettings, setUserDisabled, type AdminOverview, type AdminSettings, type AdminUser, type AuditEntry, type DomainRule, type Report, type UserFilter } from '../api';
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

const CATEGORY_LABELS: Record<string, string> = {
  gcash_bank: 'GCash / bank',
  fake_delivery: 'Fake delivery',
  job_offer: 'Job offers',
  prize: 'Prize winnings',
};

const SETTING_FIELDS: { key: keyof AdminSettings & string; label: string; hint: string }[] = [
  { key: 'scansPer15Min', label: 'Scans per 15 minutes', hint: 'Per account, max 200' },
  { key: 'maxScansPerUser', label: 'Scans kept per account', hint: 'Max 1000' },
  { key: 'scanRetentionDays', label: 'Retention (days)', hint: '1–3650' },
  { key: 'maxUploadMb', label: 'Max upload (MB)', hint: '1–16' },
];

function fmt(date: string | null) {
  return date ? new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function AdminPage() {
  const [view, setView] = useState<'overview' | 'accounts' | 'audit' | 'domains' | 'reports' | 'settings'>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [overviewLoading, setOverviewLoading] = useState(true);

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

  const [domains, setDomains] = useState<DomainRule[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [domainsError, setDomainsError] = useState('');
  const [domainDraft, setDomainDraft] = useState('');
  const [domainList, setDomainList] = useState<'block' | 'allow'>('block');
  const [domainBusy, setDomainBusy] = useState(false);

  const [reports, setReports] = useState<{ rows: Report[]; falseAlarms: number; missedScams: number } | null>(null);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState('');

  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);

  useEffect(() => {
    if (view !== 'overview') return;
    let cancelled = false; setOverviewLoading(true); setOverviewError('');
    getAdminOverview().then(result => { if (!cancelled) setOverview(result); })
      .catch(err => { if (!cancelled) setOverviewError(err instanceof Error ? err.message : 'Could not load the dashboard.'); })
      .finally(() => { if (!cancelled) setOverviewLoading(false); });
    return () => { cancelled = true; };
  }, [view]);

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

  useEffect(() => {
    if (view !== 'domains') return;
    let cancelled = false; setDomainsLoading(true); setDomainsError('');
    listDomains().then(result => { if (!cancelled) setDomains(result.rows); })
      .catch(err => { if (!cancelled) setDomainsError(err instanceof Error ? err.message : 'Could not load domains.'); })
      .finally(() => { if (!cancelled) setDomainsLoading(false); });
    return () => { cancelled = true; };
  }, [view]);

  useEffect(() => {
    if (view !== 'reports') return;
    let cancelled = false; setReportsLoading(true); setReportsError('');
    listReports().then(result => { if (!cancelled) setReports(result); })
      .catch(err => { if (!cancelled) setReportsError(err instanceof Error ? err.message : 'Could not load reports.'); })
      .finally(() => { if (!cancelled) setReportsLoading(false); });
    return () => { cancelled = true; };
  }, [view]);

  useEffect(() => {
    if (view !== 'settings') return;
    let cancelled = false; setSettingsLoading(true); setSettingsError(''); setSettingsSaved(false);
    getAdminSettings().then(result => { if (!cancelled) setSettings(result); })
      .catch(err => { if (!cancelled) setSettingsError(err instanceof Error ? err.message : 'Could not load settings.'); })
      .finally(() => { if (!cancelled) setSettingsLoading(false); });
    return () => { cancelled = true };
  }, [view]);

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

  async function submitDomain(event: FormEvent) {
    event.preventDefault();
    if (domainBusy || !domainDraft.trim()) return;
    setDomainBusy(true); setDomainsError('');
    try {
      const rule = await addDomain(domainDraft.trim(), domainList);
      setDomains(current => [...current.filter(d => d.domain !== rule.domain), rule]
        .sort((a, b) => a.list === b.list ? a.domain.localeCompare(b.domain) : a.list.localeCompare(b.list)));
      setDomainDraft('');
    } catch (err) { setDomainsError(err instanceof Error ? err.message : 'Could not add the domain.'); }
    finally { setDomainBusy(false); }
  }

  async function deleteDomain(domain: string) {
    if (domainBusy) return;
    setDomainBusy(true); setDomainsError('');
    try { await removeDomain(domain); setDomains(current => current.filter(d => d.domain !== domain)); }
    catch (err) { setDomainsError(err instanceof Error ? err.message : 'Could not remove the domain.'); }
    finally { setDomainBusy(false); }
  }

  async function submitSettings(event: FormEvent) {
    event.preventDefault();
    if (settingsBusy || !settings) return;
    setSettingsBusy(true); setSettingsError(''); setSettingsSaved(false);
    try {
      setSettings(await saveAdminSettings({
        scansPer15Min: settings.scansPer15Min, maxScansPerUser: settings.maxScansPerUser,
        scanRetentionDays: settings.scanRetentionDays, maxUploadMb: settings.maxUploadMb,
        maintenance: settings.maintenance, announcement: settings.announcement,
      }));
      setSettingsSaved(true);
    } catch (err) { setSettingsError(err instanceof Error ? err.message : 'Could not save settings.'); }
    finally { setSettingsBusy(false); }
  }

  return <section className="card">
    <h1>Account management</h1>
    <p className="muted">Manage account access. Each person's messages and scan history remain private.</p>
    <div className="admin-tabs" role="tablist">
      <button role="tab" aria-selected={view === 'overview'} className={view === 'overview' ? 'admin-tab active' : 'admin-tab'}
        onClick={() => setView('overview')}>Overview</button>
      <button role="tab" aria-selected={view === 'accounts'} className={view === 'accounts' ? 'admin-tab active' : 'admin-tab'}
        onClick={() => setView('accounts')}>Accounts</button>
      <button role="tab" aria-selected={view === 'audit'} className={view === 'audit' ? 'admin-tab active' : 'admin-tab'}
        onClick={() => setView('audit')}>Audit log</button>
      <button role="tab" aria-selected={view === 'domains'} className={view === 'domains' ? 'admin-tab active' : 'admin-tab'}
        onClick={() => setView('domains')}>Domains</button>
      <button role="tab" aria-selected={view === 'reports'} className={view === 'reports' ? 'admin-tab active' : 'admin-tab'}
        onClick={() => setView('reports')}>Reports</button>
      <button role="tab" aria-selected={view === 'settings'} className={view === 'settings' ? 'admin-tab active' : 'admin-tab'}
        onClick={() => setView('settings')}>Settings</button>
    </div>

    {view === 'overview' && <>
      {overviewError && <p role="alert" className="error-box">{overviewError}</p>}
      {overviewLoading || !overview ? <p role="status">Loading dashboard...</p> : <>
        <div className="stat-grid">
          <div className="stat-box"><div className="stat-num">{overview.totalUsers}</div><div className="stat-label">Total users</div></div>
          <div className="stat-box"><div className="stat-num">{overview.scansToday}</div><div className="stat-label">Scans today</div></div>
          <div className="stat-box"><div className="stat-num stat-safe">{overview.verdictsToday.safe}</div><div className="stat-label">Safe</div></div>
          <div className="stat-box"><div className="stat-num stat-suspicious">{overview.verdictsToday.suspicious}</div><div className="stat-label">Suspicious</div></div>
          <div className="stat-box"><div className="stat-num stat-malicious">{overview.verdictsToday.malicious}</div><div className="stat-label">Malicious</div></div>
          <div className="stat-box"><div className="stat-num stat-inconclusive">{overview.verdictsToday.inconclusive}</div><div className="stat-label">Inconclusive</div></div>
          <div className="stat-box"><div className={`stat-num${overview.health.failedToday > 0 ? ' stat-malicious' : ''}`}>{overview.health.failedToday}</div><div className="stat-label">Scans failed today</div></div>
        </div>

        <h2 className="admin-section-title">Provider health</h2>
        <div className="admin-table-wrap"><table className="history-table">
          <thead><tr><th>Provider</th><th>Status</th><th>Failures today</th></tr></thead>
          <tbody>{overview.health.providers.map(provider => <tr key={provider.id}>
            <td>{provider.label}</td>
            <td><span className={`badge ${provider.mode === 'live' ? 'badge-safe' : 'badge-neutral'}`}>{provider.mode}</span></td>
            <td>{provider.failuresToday > 0 ? <span className="signal-warn">{provider.failuresToday}</span> : 0}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="hint">"Stub" means no API key is configured — the provider returns canned data and stages may fail in real runs.</p>

        <h2 className="admin-section-title">Scam trends, last 7 days</h2>
        {overview.scamTrends7d.length === 0
          ? <p className="muted">No categorized scam scans this week.</p>
          : <div className="admin-table-wrap"><table className="history-table">
            <thead><tr><th>Category</th><th>Scans</th></tr></thead>
            <tbody>{overview.scamTrends7d.map(row => <tr key={row.category}>
              <td>{CATEGORY_LABELS[row.category] ?? row.category}</td>
              <td>{row.count}</td>
            </tr>)}</tbody>
          </table></div>}
        <p className="hint">Categories only — message text is never included in trends.</p>

        <h2 className="admin-section-title">Top flagged link domains</h2>
        {overview.topFlaggedDomains.length === 0
          ? <p className="muted">No flagged links yet.</p>
          : <div className="admin-table-wrap"><table className="history-table">
            <thead><tr><th>Domain</th><th>Times flagged</th></tr></thead>
            <tbody>{overview.topFlaggedDomains.map(row => <tr key={row.domain}>
              <td><span className="url">{row.domain}</span></td>
              <td>{row.hits}</td>
            </tr>)}</tbody>
          </table></div>}
      </>}
    </>}

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

    {view === 'domains' && <>
      <p className="muted">Blocklisted domains are always flagged; allowlisted domains are never flagged. Subdomains are included.</p>
      <form className="admin-filters" onSubmit={submitDomain}>
        <input type="text" placeholder="gcash.com" aria-label="Domain" value={domainDraft}
          onChange={e => setDomainDraft(e.target.value)} />
        <select aria-label="List" value={domainList} onChange={e => setDomainList(e.target.value as 'block' | 'allow')}>
          <option value="block">Blocklist</option>
          <option value="allow">Allowlist</option>
        </select>
        <button className="page-btn" type="submit" disabled={domainBusy || !domainDraft.trim()}>Add</button>
      </form>
      {domainsError && <p role="alert" className="error-box">{domainsError}</p>}
      {domainsLoading ? <p role="status">Loading domains...</p> : <div className="admin-table-wrap"><table className="history-table">
        <thead><tr><th>Domain</th><th>List</th><th>Added</th><th></th></tr></thead>
        <tbody>{domains.map(rule => <tr key={rule.domain}>
          <td><span className="url">{rule.domain}</span></td>
          <td><span className={`badge ${rule.list === 'block' ? 'badge-malicious' : 'badge-safe'}`}>{rule.list === 'block' ? 'Blocked' : 'Allowed'}</span></td>
          <td className="nowrap">{fmt(rule.created_at)}</td>
          <td><button className="page-btn" disabled={domainBusy} onClick={() => void deleteDomain(rule.domain)}>Remove</button></td>
        </tr>)}</tbody>
      </table>{!domains.length && <p>No domains yet. Adding a domain to a list applies to new scans.</p>}</div>}
    </>}

    {view === 'reports' && <>
      {reports && <div className="stat-grid">
        <div className="stat-box"><div className="stat-num stat-malicious">{reports.falseAlarms}</div><div className="stat-label">False alarms</div></div>
        <div className="stat-box"><div className="stat-num stat-suspicious">{reports.missedScams}</div><div className="stat-label">Missed scams</div></div>
      </div>}
      <p className="hint">Message text appears only where the reporting user chose to share it.</p>
      {reportsError && <p role="alert" className="error-box">{reportsError}</p>}
      {reportsLoading || !reports ? <p role="status">Loading reports...</p> : <div className="admin-table-wrap"><table className="history-table">
        <thead><tr><th>When</th><th>User</th><th>System said</th><th>User says</th><th>Message</th></tr></thead>
        <tbody>{reports.rows.map(row => <tr key={`${row.scanId}-${row.createdAt}`}>
          <td className="nowrap">{fmt(row.createdAt)}</td>
          <td>{row.email}</td>
          <td>{row.reported ? row.reported[0] + row.reported.slice(1).toLowerCase() : '—'}</td>
          <td>{row.expected[0] + row.expected.slice(1).toLowerCase()}</td>
          <td>{row.shared && row.text ? <span className="report-text" title={row.text}>{row.text}</span> : <span className="muted">Not shared</span>}</td>
        </tr>)}</tbody>
      </table>{!reports.rows.length && <p>No reports yet.</p>}</div>}
    </>}

    {view === 'settings' && <>
      {settingsError && <p role="alert" className="error-box">{settingsError}</p>}
      {settingsLoading || !settings ? <p role="status">Loading settings...</p> : <form className="settings-form" onSubmit={submitSettings}>
        <div className="settings-grid">
          {SETTING_FIELDS.map(({ key, label, hint }) => (
            <label className="settings-field" key={key}>{label}
              <input type="number" min={1} value={settings[key] as number}
                onChange={e => setSettings({ ...settings, [key]: Number(e.target.value) })} />
              <span className="hint">{hint}</span>
            </label>
          ))}
        </div>
        <label className="settings-field">Announcement banner
          <input type="text" maxLength={500} placeholder="Shown to every signed-in user" value={settings.announcement}
            onChange={e => setSettings({ ...settings, announcement: e.target.value })} />
          <span className="hint">Leave empty to hide the banner.</span>
        </label>
        <label className="dialog-check">
          <input type="checkbox" checked={settings.maintenance}
            onChange={e => setSettings({ ...settings, maintenance: e.target.checked })} />
          Maintenance mode — pause all new scans
        </label>
        {settingsSaved && <p className="notice">Settings saved.</p>}
        <button className="page-btn" type="submit" disabled={settingsBusy}>{settingsBusy ? 'Saving...' : 'Save settings'}</button>
      </form>}
    </>}
  </section>;
}

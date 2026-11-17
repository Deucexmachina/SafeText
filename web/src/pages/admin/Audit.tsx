import { useEffect, useState } from "react";
import { downloadAuditCsv, listAudit, type AuditEntry } from "../../api";
import { Empty, ErrorAlert, Icons, Loading, Pager, Section, ago, fmt } from "./ui";

const ACTIONS: Record<string, { label: string; tone: string; icon: () => JSX.Element }> = {
  disable_user: { label: "Disabled account", tone: "is-bad", icon: Icons.lock },
  enable_user: { label: "Enabled account", tone: "is-ok", icon: Icons.unlock },
  force_logout: { label: "Forced logout", tone: "is-muted", icon: Icons.logout },
  add_domain: { label: "Added domain", tone: "is-muted", icon: Icons.globe },
  move_domain: { label: "Moved domain", tone: "is-muted", icon: Icons.globe },
  remove_domain: { label: "Removed domain", tone: "is-muted", icon: Icons.trash },
  update_settings: { label: "Changed settings", tone: "is-muted", icon: Icons.settings },
  export_audit: { label: "Exported audit log", tone: "is-muted", icon: Icons.download },
};

/* What the action affected: the account, or (domains, settings, exports) what changed.
   Several setting changes arrive joined by "; " and are shown one per line. */
function Affected({ entry }: { entry: AuditEntry }) {
  if (entry.targetEmail) return <span className="ad-email">{entry.targetEmail}</span>;
  if (!entry.details) return <span className="ap-muted">—</span>;
  const parts = entry.details.split("; ");
  return parts.length === 1
    ? <span className="ad-audit-detail">{entry.details}</span>
    : <ul className="ad-audit-detail">{parts.map((part, i) => <li key={i}>{part}</li>)}</ul>;
}

function ActionPill({ action }: { action: string }) {
  const a = ACTIONS[action];
  return a ? <span className={`ad-pill ${a.tone}`}>{a.icon()}{a.label}</span> : <span className="ad-pill is-muted">{action}</span>;
}

export function Audit() {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    listAudit(offset).then(result => { if (!cancelled) setAudit(result.audit); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the audit log."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offset]);

  async function exportCsv() {
    setExporting(true); setError("");
    try { await downloadAuditCsv(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not export the audit log."); }
    finally { setExporting(false); }
  }

  const exportButton = (
    <button type="button" className="lp-btn lp-btn-secondary lp-btn-sm" disabled={exporting} aria-busy={exporting} onClick={() => void exportCsv()}>
      {exporting ? <span className="lp-spinner" aria-hidden="true" /> : Icons.download()}Export CSV
    </button>
  );

  return (
    <Section title="Audit log" description="Every admin action is recorded here." actions={exportButton}>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <div className="ap-card ad-table-card">
        {loading ? <Loading label="Loading audit log..." /> : !audit.length ? <Empty title="No admin actions yet." /> : <>
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Affected</th><th scope="col">By</th><th scope="col">Reason</th></tr></thead>
              <tbody>{audit.map(entry => (
                <tr key={entry.id}>
                  <td><div title={fmt(entry.createdAt)}>{ago(entry.createdAt)}</div><div className="ap-muted ad-sub">{fmt(entry.createdAt)}</div></td>
                  <td><ActionPill action={entry.action} /></td>
                  <td><Affected entry={entry} /></td>
                  <td className="ap-muted">{entry.actorEmail}</td>
                  <td>{entry.reason ?? <span className="ap-muted">—</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <ol className="ad-cards ad-timeline">
            {audit.map(entry => (
              <li key={entry.id} className="ad-card">
                <div className="ad-card-top"><ActionPill action={entry.action} /><span className="ap-muted ad-sub" title={fmt(entry.createdAt)}>{ago(entry.createdAt)}</span></div>
                <Affected entry={entry} />
                <div className="ap-muted ad-sub">By {entry.actorEmail}</div>
                {entry.reason && <div className="ad-reason-full">Reason: {entry.reason}</div>}
              </li>
            ))}
          </ol>
        </>}
        <Pager offset={offset} count={audit.length} disabled={loading} onPage={setOffset} label="Audit log pages" />
      </div>
    </Section>
  );
}

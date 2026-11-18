import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { AUDIT_PAGE_SIZE, downloadAuditCsv, listAudit, type AuditEntry, type AuditPage } from "../../api";
import { svgIcon } from "../../components/SiteNav";
import { Empty, ErrorAlert, Icons, Loading, Section, ago, fmt } from "./ui";

const ACTIONS: Record<string, { label: string; tone: string; icon: () => JSX.Element }> = {
  disable_user: { label: "Disabled account", tone: "is-bad", icon: Icons.lock },
  enable_user: { label: "Enabled account", tone: "is-ok", icon: Icons.unlock },
  force_logout: { label: "Forced logout", tone: "is-muted", icon: Icons.logout },
  grant_admin: { label: "Granted admin role", tone: "is-muted", icon: Icons.users },
  add_domain: { label: "Added domain", tone: "is-muted", icon: Icons.globe },
  move_domain: { label: "Moved domain", tone: "is-muted", icon: Icons.globe },
  remove_domain: { label: "Removed domain", tone: "is-muted", icon: Icons.trash },
  update_settings: { label: "Changed settings", tone: "is-muted", icon: Icons.settings },
  export_audit: { label: "Exported audit log", tone: "is-muted", icon: Icons.download },
};

const OPERATOR = "Server operator (command line)";
const IconChevron = () => svgIcon(18, <path d="m9 6 6 6-6 6" />);
const IconClose = () => svgIcon(20, <path d="M6 6l12 12M18 6 6 18" />);

const actionLabel = (action: string) => ACTIONS[action]?.label ?? action;
const actorOf = (entry: AuditEntry) => entry.actorEmail ?? OPERATOR;

function ActionPill({ action }: { action: string }) {
  const a = ACTIONS[action];
  return a ? <span className={`st-admin-pill ${a.tone}`}>{a.icon()}{a.label}</span> : <span className="st-admin-pill is-muted">{action}</span>;
}

/* What the action affected: the account, or (domains, settings, exports) what changed.
   Several setting changes arrive joined by "; " and are shown one per line. */
function Affected({ entry }: { entry: AuditEntry }) {
  if (entry.targetEmail) return <span className="st-admin-email">{entry.targetEmail}</span>;
  const changes = entry.view?.changes ?? [];
  if (entry.action === "update_settings" && changes.length) {
    return <ul className="st-admin-audit-detail">{changes.map((c, i) => <li key={i}>{c.label}: {c.before} → {c.after}</li>)}</ul>;
  }
  if (!entry.details) return <span className="ap-muted">—</span>;
  return <span className="st-admin-audit-detail">{entry.details}</span>;
}


/* Page numbers with ellipses: 1 … 4 5 6 … 12 */
function pageItems(current: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set([1, count, current - 1, current, current + 1].filter(n => n >= 1 && n <= count));
  const sorted = [...pages].sort((a, b) => a - b);
  return sorted.flatMap((n, i) => (i > 0 && n - sorted[i - 1] > 1 ? ["gap" as const, n] : [n]));
}

function NumberedPager({ page, count, total, disabled, onPage }: { page: number; count: number; total: number; disabled: boolean; onPage: (page: number) => void }) {
  const from = total ? (page - 1) * AUDIT_PAGE_SIZE + 1 : 0;
  const to = Math.min(total, page * AUDIT_PAGE_SIZE);
  return (
    <nav className="st-admin-numpager" aria-label="Audit log pages">
      <p className="ap-muted st-admin-sub" aria-live="polite">Showing {from}–{to} of {total.toLocaleString()}</p>
      {count > 1 && <div className="st-admin-numpager-btns">
        <button type="button" className="ap-page-btn" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>‹ Previous</button>
        <ol>
          {pageItems(page, count).map((item, i) => item === "gap"
            ? <li key={`gap${i}`} className="st-admin-gap" aria-hidden="true">…</li>
            : <li key={item}>
                <button type="button" className="st-admin-page-num" disabled={disabled} aria-current={item === page ? "page" : undefined}
                  aria-label={`Page ${item}`} onClick={() => onPage(item)}>{item}</button>
              </li>)}
        </ol>
        <button type="button" className="ap-page-btn" disabled={disabled || page >= count} onClick={() => onPage(page + 1)}>Next ›</button>
      </div>}
    </nav>
  );
}

/* Details: a side panel on desktop, a bottom sheet on phones. Native <dialog> gives
   focus trapping and Esc; clicking outside closes it; focus returns to the row. */
function DetailPanel({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    closeBtn.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  const view = entry.view ?? { fields: [], changes: [], note: entry.details ? null : "No additional details were recorded for this action." };
  const longChange = (before: string, after: string) => before.length + after.length > 48;

  return (
    <dialog ref={ref} className="st-admin-drawer" aria-labelledby="audit-detail-title" onClose={onClose}
      onClick={e => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="st-admin-drawer-body">
        <header className="st-admin-drawer-head">
          <div>
            <p className="st-admin-drawer-kicker">Audit entry</p>
            <h2 id="audit-detail-title" className="visually-hidden">{actionLabel(entry.action)}</h2>
            <ActionPill action={entry.action} />
          </div>
          <button ref={closeBtn} type="button" className="st-admin-drawer-close" aria-label="Close details" onClick={() => ref.current?.close()}><IconClose /></button>
        </header>

        <dl className="st-admin-kv">
          <div><dt>When</dt><dd>{fmt(entry.createdAt)} <span className="ap-muted">({ago(entry.createdAt).toLowerCase()})</span></dd></div>
          <div><dt>By</dt><dd>{actorOf(entry)}</dd></div>
        </dl>

        <section className="st-admin-drawer-section" aria-labelledby="audit-what">
          <h3 id="audit-what">What happened</h3>
          {view.fields.length > 0 && (
            <dl className="st-admin-kv">
              {view.fields.map((f, i) => <div key={i}><dt>{f.label}</dt><dd className={f.mono ? "st-admin-mono" : undefined}>{f.value}</dd></div>)}
            </dl>
          )}
          {view.changes.length > 0 && (
            <ul className="st-admin-changes">
              {view.changes.map((c, i) => (
                <li key={i} className={longChange(c.before, c.after) ? "is-long" : undefined}>
                  <span className="st-admin-change-label">{c.label}</span>
                  {longChange(c.before, c.after) ? (
                    <span className="st-admin-change-blocks">
                      <span><span className="st-admin-change-tag">Before</span><span className="st-admin-change-text">{c.before}</span></span>
                      <span><span className="st-admin-change-tag">After</span><span className="st-admin-change-text">{c.after}</span></span>
                    </span>
                  ) : (
                    <span className="st-admin-change-inline"><span className="st-admin-change-from">{c.before}</span><span aria-label="changed to">→</span><strong>{c.after}</strong></span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {view.note && <p className="st-admin-drawer-note">{Icons.info()}<span>{view.note}</span></p>}
        </section>

        <section className="st-admin-drawer-section" aria-labelledby="audit-reason">
          <h3 id="audit-reason">Reason</h3>
          {entry.reason ? <p className="st-admin-reason-text">{entry.reason}</p> : <p className="st-admin-no-reason">No reason given</p>}
        </section>

        <details className="st-admin-more">
          <summary>More details</summary>
          <dl className="st-admin-kv st-admin-kv-small">
            <div><dt>Log ID</dt><dd className="st-admin-mono">{String(entry.id)}</dd></div>
            <div><dt>Action code</dt><dd className="st-admin-mono">{entry.action}</dd></div>
            <div><dt>Recorded at</dt><dd className="st-admin-mono">{new Date(entry.createdAt).toISOString()}</dd></div>
            {entry.details && <div><dt>Recorded details</dt><dd>{entry.details}</dd></div>}
          </dl>
        </details>
      </div>
    </dialog>
  );
}

export function Audit() {
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("page") ?? 1);
  const page = Number.isSafeInteger(requested) && requested >= 1 ? requested : 1;
  const [data, setData] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const tableTop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    listAudit(page).then(result => { if (!cancelled) setData(result); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the audit log."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page]);

  // The page lives in the URL (&page=2) so refresh and Back keep your place.
  function goTo(next: number) {
    setParams(prev => {
      const updated = new URLSearchParams(prev);
      if (next <= 1) updated.delete("page"); else updated.set("page", String(next));
      return updated;
    });
    tableTop.current?.scrollIntoView({ block: "nearest" });
  }

  async function exportCsv() {
    setExporting(true); setError("");
    try { await downloadAuditCsv(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not export the audit log."); }
    finally { setExporting(false); }
  }

  function show(entry: AuditEntry, el: HTMLElement) { opener.current = el; setOpen(entry); }
  function closeDetails() {
    setOpen(null);
    // Return focus to the row that opened the panel.
    window.setTimeout(() => opener.current?.focus(), 0);
  }
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, entry: AuditEntry) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(entry, e.currentTarget); }
  };

  const exportButton = (
    <button type="button" className="lp-btn lp-btn-secondary lp-btn-sm" disabled={exporting} aria-busy={exporting} onClick={() => void exportCsv()}>
      {exporting ? <span className="lp-spinner" aria-hidden="true" /> : Icons.download()}Export CSV
    </button>
  );

  const audit = data?.audit ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  let body: ReactNode;
  if (loading) body = <Loading label="Loading audit log..." rows={6} />;
  else if (!total) body = <Empty title="No admin actions yet.">Changes made in the admin console will appear here.</Empty>;
  else if (!audit.length) body = (
    <Empty title="This page is empty.">
      There are only {pageCount} {pageCount === 1 ? "page" : "pages"} of entries.{" "}
      <button type="button" className="ap-text-btn" onClick={() => goTo(1)}>Go to the first page</button>
    </Empty>
  );
  else body = <>
    <div className="st-admin-table-wrap">
      <table className="st-admin-table st-admin-audit-table">
        <thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Affected</th><th scope="col">By</th><th scope="col"><span className="visually-hidden">Details</span></th></tr></thead>
        <tbody>{audit.map(entry => (
          <tr key={String(entry.id)} className="st-admin-row-click" tabIndex={0} aria-haspopup="dialog"
            aria-label={`${actionLabel(entry.action)}, ${ago(entry.createdAt)}. Open details`}
            onClick={e => show(entry, e.currentTarget)} onKeyDown={e => onRowKey(e, entry)}>
            <td><div title={fmt(entry.createdAt)}>{ago(entry.createdAt)}</div><div className="ap-muted st-admin-sub">{fmt(entry.createdAt)}</div></td>
            <td><ActionPill action={entry.action} /></td>
            <td><Affected entry={entry} /></td>
            <td className="ap-muted">{actorOf(entry)}</td>
            <td className="st-admin-chevron-cell"><span className="st-admin-row-chevron" aria-hidden="true"><IconChevron /></span></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
    <ol className="st-admin-cards st-admin-timeline">
      {audit.map(entry => (
        <li key={String(entry.id)}>
          <button type="button" className="st-admin-card st-admin-card-btn" aria-haspopup="dialog" onClick={e => show(entry, e.currentTarget)}>
            <span className="st-admin-card-top"><ActionPill action={entry.action} /><span className="ap-muted st-admin-sub">{ago(entry.createdAt)}</span></span>
            <Affected entry={entry} />
            <span className="ap-muted st-admin-sub">By {actorOf(entry)}</span>
            <span className="st-admin-card-chevron st-admin-row-chevron" aria-hidden="true"><IconChevron /></span>
          </button>
        </li>
      ))}
    </ol>
  </>;

  return (
    <Section title="Audit log" description="Every admin action is recorded here. Select an entry to see its details." actions={exportButton}>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <div className="ap-card st-admin-table-card" ref={tableTop} aria-busy={loading}>
        {body}
        {!loading && total > 0 && <NumberedPager page={page} count={pageCount} total={total} disabled={loading} onPage={goTo} />}
      </div>
      {open && <DetailPanel entry={open} onClose={closeDetails} />}
    </Section>
  );
}

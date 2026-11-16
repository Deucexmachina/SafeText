import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, deleteScan, listScans, storagePolicy, type ScanSummary } from "../api";
import { VerdictBadge } from "../components/VerdictBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { svgIcon } from "../components/SiteNav";
import { VERDICT_META, friendlyDate, verdictKind, type VerdictKind } from "../components/verdict";

const PAGE_SIZE = 10;

const IconTrash = () => svgIcon(18, <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />);
const IconInfo = () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5h.01" /></>);
const IconSearch = () => svgIcon(18, <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
const IconImage = () => svgIcon(15, <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m20.5 16-5-5-8.5 8.5" /></>);
const IconChevron = () => svgIcon(18, <path d="m9 6 6 6-6 6" />);
const IconHistory = () => svgIcon(30, <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v4h4" /><path d="M12 8v4.5l3 2" /></>);
const IconAlert = () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" /></>);

type Filter = "all" | VerdictKind;
const FILTERS: Filter[] = ["all", "safe", "suspicious", "malicious", "inconclusive"];

const rowKind = (s: ScanSummary) => verdictKind(s.status === "RUNNING" ? "RUNNING" : s.verdict);
const previewText = (s: ScanSummary) => s.preview ?? (s.inputType === "image" ? "[screenshot]" : "—");

function Preview({ scan }: { scan: ScanSummary }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const text = previewText(scan);
  // Offer "Show more" only when the two-line clamp actually hides text.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);
  return (
    <span className="ap-preview">
      <span ref={textRef} className={expanded ? "ap-preview-text" : "ap-preview-text ap-clamp"}>
        {scan.inputType === "image" && <span className="ap-preview-type" title="Screenshot"><IconImage /><span className="visually-hidden">Screenshot: </span></span>}
        {text}
      </span>
      {(overflowing || expanded) && (
        <button type="button" className="ap-text-btn ap-more" aria-expanded={expanded}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </span>
  );
}

export function HistoryPage() {
  const [scans, setScans] = useState<ScanSummary[] | null>(null);
  const [policy, setPolicy] = useState<{ scanRetentionDays: number; maxScansPerUser: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScanSummary | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const nav = useNavigate();

  const removeScan = async (scan: ScanSummary) => {
    if (deletingId) return;
    setDeletingId(scan.scanId);
    setDeleteError(null);
    try {
      await deleteScan(scan.scanId);
      setScans(previous => previous?.filter(item => item.scanId !== scan.scanId) ?? []);
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.detail : "Couldn't delete this scan. Please try again.");
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  };

  useEffect(() => {
    Promise.all([listScans(), storagePolicy()])
      .then(([r, limits]) => { setScans(r.scans); setPolicy(limits); })
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? e.detail
            : "Couldn't load scan history. Is the server running?",
        ),
      );
  }, []);

  // Search and filter run on the already-loaded list (no extra API calls).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (scans ?? []).filter(s =>
      (filter === "all" || rowKind(s) === filter) &&
      (!q || previewText(s).toLowerCase().includes(q)));
  }, [scans, query, filter]);
  useEffect(() => { setPage(0); }, [query, filter]);

  const header = <header className="ap-page-head">
    <h1>History</h1>
    <p className="ap-lead">Messages you've checked. Tap one to see the full result.</p>
  </header>;

  if (error) return <div className="ap-page">{header}
    <section className="ap-card ap-state" role="alert">
      <span className="ap-state-icon ap-state-error"><IconAlert /></span>
      <h2>We couldn't load your history</h2>
      <p className="ap-muted">{error}</p>
      <button type="button" className="lp-btn lp-btn-secondary" onClick={() => window.location.reload()}>Try again</button>
    </section>
  </div>;

  if (!scans) return <div className="ap-page" aria-busy="true">{header}
    <p role="status" className="visually-hidden">Loading your history…</p>
    <div className="ap-card ap-skeleton" aria-hidden="true">{[0, 1, 2].map(i => <div key={i} className="ap-skel-row"><span /><span /><span /></div>)}</div>
  </div>;

  const retentionNotice = policy && <div className="ap-alert ap-alert-info ap-retention"><IconInfo /><p>History is kept for up to {policy.scanRetentionDays} days,
    with at most {policy.maxScansPerUser} scans per account. Oldest finished scans may be removed sooner when storage is full.
    Screenshots are discarded after extraction or failure.</p></div>;

  if (scans.length === 0) {
    return <div className="ap-page">{header}
      <section className="ap-card ap-state">
        <span className="ap-state-icon"><IconHistory /></span>
        <h2>No scans yet</h2>
        <p className="ap-muted">When you check a message, it shows up here so you can look back at the result.</p>
        <Link to="/" className="lp-btn lp-btn-primary lp-btn-lg">Scan a message</Link>
      </section>
      {retentionNotice}
    </div>;
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const open = (s: ScanSummary) => nav(`/scan/${s.scanId}`);
  const deleteButton = (s: ScanSummary) => (
    <span className="ap-tip">
      <button type="button" className="ap-icon-btn ap-delete"
        aria-label={deletingId === s.scanId ? "Deleting scan" : `Delete scan from ${friendlyDate(s.createdAt)}`}
        disabled={deletingId !== null} aria-busy={deletingId === s.scanId}
        onClick={e => { e.stopPropagation(); setPendingDelete(s); }}>
        {deletingId === s.scanId ? <span className="lp-spinner" aria-hidden="true" /> : <IconTrash />}
      </button>
      <span className="ap-tip-text" aria-hidden="true">Delete</span>
    </span>
  );

  return (
    <div className="ap-page">
      {header}
      {retentionNotice}

      {pendingDelete && <ConfirmDialog
        title="Delete this scan?"
        message="This scan will be permanently removed from your history. This action cannot be undone."
        confirmLabel="Delete scan" busyLabel="Deleting..." danger busy={deletingId !== null}
        onCancel={() => setPendingDelete(null)} onConfirm={() => void removeScan(pendingDelete)}
      />}
      {deleteError && <div className="ap-alert ap-alert-error" role="alert"><IconAlert /><span>{deleteError}</span></div>}

      <div className="ap-card ap-history">
        <div className="ap-toolbar">
          <div className="ap-search">
            <label htmlFor="history-search" className="visually-hidden">Search messages</label>
            <IconSearch />
            <input id="history-search" type="search" placeholder="Search messages" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="ap-filters" role="group" aria-label="Filter by verdict">
            {FILTERS.map(f => (
              <button key={f} type="button" className="ap-filter" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : VERDICT_META[f].label}
              </button>
            ))}
          </div>
        </div>
        <p className="visually-hidden" role="status" aria-live="polite">{filtered.length} {filtered.length === 1 ? "scan" : "scans"} shown</p>

        {filtered.length === 0 ? (
          <div className="ap-state ap-state-inline">
            <h2>No scans match</h2>
            <p className="ap-muted">Try a different word or verdict.</p>
            <button type="button" className="lp-btn lp-btn-secondary" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button>
          </div>
        ) : (
          <>
            {/* Desktop: table. Phones: stacked cards (same data). */}
            <table className="ap-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Message</th>
                  <th scope="col">Verdict</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.scanId} onClick={() => open(s)}>
                    <td className="ap-when"><Link to={`/scan/${s.scanId}`} onClick={e => e.stopPropagation()}>{friendlyDate(s.createdAt)}</Link></td>
                    <td><Preview scan={s} /></td>
                    <td><VerdictBadge value={s.status === "RUNNING" ? "RUNNING" : s.verdict} /></td>
                    <td className="ap-row-actions">{deleteButton(s)}<span className="ap-row-go" aria-hidden="true"><IconChevron /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="ap-list">
              {visible.map((s) => (
                <li key={s.scanId} className={`ap-item ap-item-${rowKind(s)}`}>
                  <div className="ap-item-top">
                    <VerdictBadge value={s.status === "RUNNING" ? "RUNNING" : s.verdict} />
                    <span className="ap-when">{friendlyDate(s.createdAt)}</span>
                  </div>
                  <Preview scan={s} />
                  <div className="ap-item-actions">
                    <Link to={`/scan/${s.scanId}`} className="lp-btn lp-btn-secondary lp-btn-sm">View result</Link>
                    {deleteButton(s)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {pageCount > 1 && (
          <nav className="ap-pagination" aria-label="History pages">
            <button type="button" className="ap-page-btn" disabled={current === 0} onClick={() => setPage(current - 1)}>‹ Prev</button>
            <span className="ap-muted">Page {current + 1} of {pageCount}</span>
            <button type="button" className="ap-page-btn" disabled={current === pageCount - 1} onClick={() => setPage(current + 1)}>Next ›</button>
          </nav>
        )}
      </div>
    </div>
  );
}

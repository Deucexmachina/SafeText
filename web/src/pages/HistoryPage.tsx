import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, deleteScan, listScans, type ScanSummary } from "../api";
import { VerdictBadge } from "../components/VerdictBadge";

const PAGE_SIZE = 5;

export function HistoryPage() {
  const [scans, setScans] = useState<ScanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const nav = useNavigate();

  const removeScan = async (scan: ScanSummary) => {
    if (deletingId || !window.confirm("Delete this scan from your history? This cannot be undone.")) return;
    setDeletingId(scan.scanId);
    setDeleteError(null);
    try {
      await deleteScan(scan.scanId);
      setScans(previous => previous?.filter(item => item.scanId !== scan.scanId) ?? []);
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.detail : "Couldn't delete this scan. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    listScans()
      .then((r) => setScans(r.scans))
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? e.detail
            : "Couldn't load scan history. Is the server running?",
        ),
      );
  }, []);

  if (error) return <p className="error-box">{error}</p>;
  if (!scans) return <p className="muted">Loading…</p>;
  if (scans.length === 0) {
    return <p className="muted">No scans yet. Check a message first.</p>;
  }

  const pageCount = Math.ceil(scans.length / PAGE_SIZE);
  const current = Math.min(page, pageCount - 1);
  const visible = scans.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="card table-card">
      {deleteError && <p className="error-box" role="alert">{deleteError}</p>}
      <table className="history-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Message</th>
            <th>Verdict</th>
            <th><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => (
            <tr key={s.scanId} onClick={() => nav(`/scan/${s.scanId}`)}>
              <td className="nowrap">
                {new Date(s.createdAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </td>
              <td className="preview">
                {s.preview ?? (s.inputType === "image" ? "[screenshot]" : "—")}
              </td>
              <td>
                <VerdictBadge
                  value={s.status === "RUNNING" ? "RUNNING" : s.verdict}
                />
              </td>
              <td className="history-actions">
                <button
                  type="button"
                  className="delete-scan-btn"
                  aria-label={deletingId === s.scanId ? "Deleting scan" : "Delete scan from your history"}
                  title="Delete scan"
                  disabled={deletingId !== null}
                  aria-busy={deletingId === s.scanId}
                  onClick={event => { event.stopPropagation(); void removeScan(s); }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pageCount > 1 && (
        <div className="pagination">
          <button
            className="page-btn"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            ‹ Prev
          </button>
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              className={i === current ? "page-btn active" : "page-btn"}
              onClick={() => setPage(i)}
            >
              {i + 1}
            </button>
          ))}
          <button
            className="page-btn"
            disabled={current === pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

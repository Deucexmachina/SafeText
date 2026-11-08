import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, listScans, type ScanSummary } from "../api";
import { VerdictBadge } from "../components/VerdictBadge";

const PAGE_SIZE = 5;

export function HistoryPage() {
  const [scans, setScans] = useState<ScanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const nav = useNavigate();

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
      <table className="history-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Message</th>
            <th>Verdict</th>
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

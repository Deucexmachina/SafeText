import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, listScans, type ScanSummary } from "../api";
import { VerdictBadge } from "../components/VerdictBadge";

export function HistoryPage() {
  const [scans, setScans] = useState<ScanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          {scans.map((s) => (
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
    </div>
  );
}

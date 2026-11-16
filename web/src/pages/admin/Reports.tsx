import { useEffect, useState } from "react";
import { listReports, type Report } from "../../api";
import { VerdictTag, verdictKind } from "../../components/verdict";
import { Empty, ErrorAlert, Icons, Loading, Note, Section, StatTile, ago, fmt } from "./ui";

function SharedText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ad-shared">
      <span className={open ? "" : "ap-clamp"}>{text}</span>
      {text.length > 80 && <button type="button" className="ap-text-btn ap-more" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "Show less" : "Show more"}</button>}
    </div>
  );
}

function Verdicts({ row }: { row: Report }) {
  return (
    <span className="ad-verdict-change">
      {row.reported ? <VerdictTag kind={verdictKind(row.reported)} /> : <span className="ap-muted">—</span>}
      <span className="ad-arrow" aria-label="user says">{Icons.arrow()}</span>
      <VerdictTag kind={verdictKind(row.expected)} />
    </span>
  );
}

export function Reports() {
  const [reports, setReports] = useState<{ rows: Report[]; falseAlarms: number; missedScams: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    listReports().then(result => { if (!cancelled) setReports(result); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load reports."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Section title="Reports" description="When users tell us a verdict was wrong, it shows up here.">
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {reports && <div className="ad-stats ad-stats-2">
        <div>
          <StatTile label="False alarms" value={reports.falseAlarms} icon={Icons.flag()} />
          <p className="ad-stat-help ap-muted">Flagged as Suspicious or Malicious, but the user says it was Safe.</p>
        </div>
        <div>
          <StatTile label="Missed scams" value={reports.missedScams} icon={Icons.alert()} />
          <p className="ad-stat-help ap-muted">Marked Safe, but the user says it was a scam.</p>
        </div>
      </div>}
      <Note>Message text appears only where the reporting user chose to share it.</Note>

      <div className="ap-card ad-table-card">
        {loading || !reports ? (loading && <Loading label="Loading reports..." />) : !reports.rows.length ? <Empty title="No reports yet." /> : <>
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th scope="col">When</th><th scope="col">User</th><th scope="col">System said → user says</th><th scope="col">Message</th></tr></thead>
              <tbody>{reports.rows.map(row => (
                <tr key={`${row.scanId}-${row.createdAt}`}>
                  <td title={fmt(row.createdAt)}>{ago(row.createdAt)}</td>
                  <td className="ad-email">{row.email}</td>
                  <td><Verdicts row={row} /></td>
                  <td>{row.shared && row.text ? <SharedText text={row.text} /> : <span className="ap-muted ad-sub">{Icons.lock()} Not shared</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <ul className="ad-cards">
            {reports.rows.map(row => (
              <li key={`${row.scanId}-${row.createdAt}`} className="ad-card">
                <div className="ad-card-top"><span className="ad-email">{row.email}</span><span className="ap-muted ad-sub">{ago(row.createdAt)}</span></div>
                <div><span className="ap-muted ad-sub">System said → user says</span><Verdicts row={row} /></div>
                {row.shared && row.text ? <SharedText text={row.text} /> : <span className="ap-muted ad-sub">{Icons.lock()} Message not shared</span>}
              </li>
            ))}
          </ul>
        </>}
      </div>
    </Section>
  );
}

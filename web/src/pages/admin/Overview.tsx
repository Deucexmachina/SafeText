import { useCallback, useEffect, useState } from "react";
import { getAdminOverview, type AdminOverview } from "../../api";
import { VerdictTag, type VerdictKind } from "../../components/verdict";
import { BarTable, Empty, ErrorAlert, Icons, Loading, Note, Section, StatTile } from "./ui";

const CATEGORY_LABELS: Record<string, string> = {
  gcash_bank: "GCash / bank",
  fake_delivery: "Fake delivery",
  job_offer: "Job offers",
  prize: "Prize winnings",
};

const VERDICTS = ["safe", "suspicious", "malicious", "inconclusive"] as const satisfies readonly VerdictKind[];

export function Overview() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback((signal: { cancelled: boolean }) => {
    setLoading(true); setError("");
    getAdminOverview().then(result => { if (!signal.cancelled) { setOverview(result); setUpdatedAt(new Date()); } })
      .catch(err => { if (!signal.cancelled) setError(err instanceof Error ? err.message : "Could not load the dashboard."); })
      .finally(() => { if (!signal.cancelled) setLoading(false); });
  }, []);

  useEffect(() => { const signal = { cancelled: false }; load(signal); return () => { signal.cancelled = true; }; }, [load]);

  const refresh = (
    <button type="button" className="lp-btn lp-btn-secondary lp-btn-sm" disabled={loading} onClick={() => load({ cancelled: false })}>
      {loading ? <span className="lp-spinner" aria-hidden="true" /> : Icons.refresh()}Refresh
    </button>
  );

  return (
    <Section title="Overview" description={updatedAt ? `Today's activity · updated ${updatedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "Today's activity"} actions={refresh}>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {!overview ? (loading && <Loading label="Loading dashboard..." />) : (() => {
        const v = overview.verdictsToday;
        const total = v.safe + v.suspicious + v.malicious + v.inconclusive;
        const failed = overview.health.failedToday;
        return <div className="ad-overview">
          <div className="ad-stats">
            <StatTile label="Total users" value={overview.totalUsers} icon={Icons.users()} />
            <StatTile label="Scans today" value={overview.scansToday} icon={Icons.scan()} />
            <StatTile label="Scans failed today" value={failed} icon={Icons.alert()} tone={failed > 0 ? "warn" : "ok"}
              status={failed > 0 ? "Check provider health below" : "No failures"} />
          </div>

          <div className="ad-grid">
            <div className="ap-card ad-panel">
              <h3>Verdicts today</h3>
              {total === 0 ? <Empty title="No finished scans today" /> : <>
                <div className="ad-split" aria-hidden="true">
                  {VERDICTS.map(k => v[k] > 0 && <span key={k} className={`ad-split-${k}`} style={{ flexGrow: v[k] }} />)}
                </div>
                <table className="ad-verdicts">
                  <caption className="visually-hidden">Verdicts for scans finished today</caption>
                  <tbody>
                    {VERDICTS.map(k => (
                      <tr key={k}>
                        <th scope="row"><VerdictTag kind={k} /></th>
                        <td className="ad-num">{v[k].toLocaleString()}</td>
                        <td className="ad-pct ap-muted">{Math.round((v[k] / total) * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>}
            </div>

            <div className="ap-card ad-panel">
              <h3>Provider health</h3>
              <ul className="ad-providers">
                {overview.health.providers.map(p => {
                  const live = p.mode === "live";
                  return (
                    <li key={p.id}>
                      <span className="ad-provider-name">{p.label}</span>
                      <span className={`ad-pill ${live ? "is-ok" : "is-muted"}`}>{live ? Icons.check(14) : Icons.info()}{live ? "Live" : p.mode === "stub" ? "Stub" : p.mode}</span>
                      <span className={`ad-provider-fail${p.failuresToday > 0 ? " is-warn" : ""}`}>
                        {p.failuresToday > 0 && Icons.alert(14)}{p.failuresToday} {p.failuresToday === 1 ? "failure" : "failures"} today
                      </span>
                    </li>
                  );
                })}
              </ul>
              <Note>"Stub" means no API key is configured — the provider returns canned data and stages may fail in real runs.</Note>
            </div>

            <div className="ap-card ad-panel">
              <h3>Scam trends, last 7 days</h3>
              {overview.scamTrends7d.length === 0
                ? <Empty title="No categorized scam scans this week." />
                : <BarTable caption="Scam scans by category, last 7 days" nameLabel="Category" valueLabel="Scans"
                    rows={overview.scamTrends7d.map(r => ({ name: CATEGORY_LABELS[r.category] ?? r.category, value: r.count }))} />}
              <Note>Categories only — message text is never included in trends.</Note>
            </div>

            <div className="ap-card ad-panel">
              <h3>Top flagged link domains</h3>
              {overview.topFlaggedDomains.length === 0
                ? <Empty title="No flagged links yet." />
                : <BarTable caption="Most-flagged link domains" nameLabel="Domain" valueLabel="Times flagged" mono
                    rows={overview.topFlaggedDomains.map(r => ({ name: r.domain, value: r.hits }))} />}
            </div>
          </div>
        </div>;
      })()}
    </Section>
  );
}

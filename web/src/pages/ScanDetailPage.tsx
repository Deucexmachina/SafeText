import { Link, useNavigate, useParams } from "react-router-dom";
import { useScan } from "../useScan";
import { ResultCard } from "../components/ResultCard";
import { svgIcon } from "../components/SiteNav";

const IconBack = () => svgIcon(18, <path d="M19 12H5m6-6-6 6 6 6" />);
const IconAlert = () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" /></>);

export function ScanDetailPage() {
  const { id } = useParams();
  const { scan, error } = useScan(id ?? null);
  const nav = useNavigate();

  function goBack() {
    if ((window.history.state?.idx ?? 0) > 0) nav(-1);
    else nav("/history");
  }

  return (
    <div className="ap-page">
      <button type="button" className="ap-back" onClick={goBack}><IconBack />Back to history</button>
      <header className="ap-page-head"><h1>Scan result</h1></header>
      {error ? (
        <section className="ap-card ap-state" role="alert">
          <span className="ap-state-icon ap-state-error"><IconAlert /></span>
          <h2>We couldn't load this result</h2>
          <p className="ap-muted">{error}</p>
          <Link to="/history" className="lp-btn lp-btn-secondary">Back to history</Link>
        </section>
      ) : !scan ? (
        <div className="ap-card ap-skeleton" aria-busy="true">
          <p role="status" className="visually-hidden">Loading the result…</p>
          {[0, 1, 2].map(i => <div key={i} className="ap-skel-row" aria-hidden="true"><span /><span /><span /></div>)}
        </div>
      ) : scan.status === "RUNNING" ? (
        <section className="ap-card ap-state" aria-live="polite">
          <span className="ap-state-icon"><span className="lp-spinner" aria-hidden="true" /></span>
          <h2>Checking your message</h2>
          <p className="ap-muted" role="status">This page updates by itself when the result is ready.</p>
        </section>
      ) : (
        <ResultCard scan={scan} />
      )}
    </div>
  );
}

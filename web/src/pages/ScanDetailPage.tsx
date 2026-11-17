import { Link, useNavigate, useParams } from "react-router-dom";
import { useScan } from "../useScan";
import { ResultCard, ResultStateCard } from "../components/ResultCard";
import { svgIcon } from "../components/SiteNav";

const IconBack = () => svgIcon(18, <path d="M19 12H5m6-6-6 6 6 6" />);
const IconAlert = () => svgIcon(22, <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" /></>);

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
      <header className="sr-page-head">
        <button type="button" className="ap-back" onClick={goBack}><IconBack />Back to history</button>
        <h1>Scan result</h1>
      </header>
      {error ? (
        <ResultStateCard tone="error" icon={<IconAlert />} title="We couldn't load this result">
          <p>{error}</p>
          <Link to="/history" className="lp-btn lp-btn-secondary">Back to history</Link>
        </ResultStateCard>
      ) : !scan ? (
        <ResultStateCard icon={<span className="lp-spinner" />} title="Loading the result…" live />
      ) : scan.status === "RUNNING" ? (
        <ResultStateCard icon={<span className="lp-spinner" />} title="Scanning…" live>
          <p role="status">We're still checking this message. This page updates by itself when the result is ready.</p>
        </ResultStateCard>
      ) : (
        <ResultCard scan={scan} />
      )}
    </div>
  );
}

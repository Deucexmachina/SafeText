import { useNavigate, useParams } from "react-router-dom";
import { useScan } from "../useScan";
import { ResultCard } from "../components/ResultCard";

export function ScanDetailPage() {
  const { id } = useParams();
  const { scan, error } = useScan(id ?? null);
  const nav = useNavigate();

  function goBack() {
    if ((window.history.state?.idx ?? 0) > 0) nav(-1);
    else nav("/history");
  }

  return (
    <>
      <button className="back-btn" onClick={goBack}>
        ← Back to history
      </button>
      {error ? (
        <p className="error-box">{error}</p>
      ) : !scan ? (
        <p className="muted">Loading…</p>
      ) : scan.status === "RUNNING" ? (
        <p className="checking">Checking your message</p>
      ) : (
        <ResultCard scan={scan} />
      )}
    </>
  );
}

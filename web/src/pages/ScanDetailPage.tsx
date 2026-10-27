import { useParams } from "react-router-dom";
import { useScan } from "../useScan";
import { ResultCard } from "../components/ResultCard";

export function ScanDetailPage() {
  const { id } = useParams();
  const { scan, error } = useScan(id ?? null);

  if (error) return <p className="error-box">{error}</p>;
  if (!scan) return <p className="muted">Loading…</p>;
  if (scan.status === "RUNNING") {
    return <p className="checking">Checking your message</p>;
  }
  return <ResultCard scan={scan} />;
}

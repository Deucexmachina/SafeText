import { useEffect, useState } from "react";
import { ApiError, getScan, type ScanResult } from "./api";

// Polls GET /api/v1/scan/:id every 2 s until the scan reaches a final status.
export function useScan(scanId: string | null) {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    let timer: number | undefined;
    setScan(null);
    setError(null);

    const tick = async () => {
      try {
        const s = await getScan(scanId);
        if (cancelled) return;
        setScan(s);
        if (s.status === "RUNNING") {
          timer = window.setTimeout(tick, 2000);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof ApiError ? e.detail : "Couldn't load the scan result.",
          );
        }
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [scanId]);

  return { scan, error };
}

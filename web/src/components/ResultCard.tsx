import type { ScanResult } from "../api";

function verdictClass(v: string): string {
  switch (v) {
    case "SAFE":
      return "safe";
    case "SUSPICIOUS":
      return "suspicious";
    case "MALICIOUS":
      return "malicious";
    default:
      return "inconclusive";
  }
}

const STAGE_LABELS: Record<string, string> = {
  extraction: "text extraction",
  analysis: "analysis",
  threat_intel: "link check",
};

export function ResultCard({ scan }: { scan: ScanResult }) {
  const a = scan.analysis;
  const cls = verdictClass(a?.verdict ?? "INCONCLUSIVE");
  const flagged = scan.threatIntel?.urls.filter((u) => u.threat) ?? [];

  return (
    <section className="card result">
      {scan.status === "INCONCLUSIVE" && !a && (
        <>
          <div className="verdict verdict-inconclusive">Inconclusive</div>
          <p className="muted">
            We couldn't read or analyze this message. Try pasting the text
            instead.
          </p>
        </>
      )}

      {a && (
        <>
          <div className={`verdict verdict-${cls}`}>
            {a.verdict === "INCONCLUSIVE"
              ? "Inconclusive"
              : a.verdict[0] + a.verdict.slice(1).toLowerCase()}
          </div>

          <div className="confidence">
            <span className="confidence-num">
              Confidence {a.confidence}
            </span>
            <div className="bar">
              <div
                className={`bar-fill fill-${cls}`}
                style={{ width: `${a.confidence}%` }}
              />
            </div>
          </div>

          {scan.status === "PARTIAL" && (
            <p className="notice">
              Some checks didn't finish (
              {scan.incomplete
                .map((s) => STAGE_LABELS[s] ?? s)
                .join(", ")}
              ), so this result may be incomplete.
            </p>
          )}

          <h3>Why</h3>
          <ul className="reasons">
            {a.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>

          <h3>Details found</h3>
          <table className="entities">
            <tbody>
              <tr>
                <th>Sender</th>
                <td>{a.entities.senderId ?? "—"}</td>
              </tr>
              <tr>
                <th>Links</th>
                <td>
                  {a.entities.urls.length === 0
                    ? "—"
                    : a.entities.urls.map((u) => (
                        <div key={u} className="url">
                          {u}
                        </div>
                      ))}
                </td>
              </tr>
              <tr>
                <th>Numbers</th>
                <td>
                  {a.entities.phoneNumbers.length === 0
                    ? "—"
                    : a.entities.phoneNumbers.join(", ")}
                </td>
              </tr>
            </tbody>
          </table>

          {flagged.length > 0 && (
            <>
              <h3>Flagged links</h3>
              <ul className="reasons">
                {flagged.map((u) => (
                  <li key={u.url}>
                    <span className="url">{u.url}</span> — {u.threat}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {scan.extraction?.text && (
        <div className="checked-msg">
          <h3>Message checked</h3>
          <blockquote>{scan.extraction.text}</blockquote>
        </div>
      )}

      <p className="muted scan-meta">
        Scan {scan.scanId} ·{" "}
        {new Date(scan.createdAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </p>
    </section>
  );
}

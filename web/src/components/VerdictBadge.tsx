import type { ScanStatus, Verdict } from "../api";

const LABELS: Record<string, string> = {
  SAFE: "Safe",
  SUSPICIOUS: "Suspicious",
  MALICIOUS: "Malicious",
  INCONCLUSIVE: "Inconclusive",
  RUNNING: "Checking",
  COMPLETE: "Done",
  PARTIAL: "Partial",
};

export function badgeClass(v: Verdict | ScanStatus | null): string {
  switch (v) {
    case "SAFE":
      return "badge badge-safe";
    case "SUSPICIOUS":
      return "badge badge-suspicious";
    case "MALICIOUS":
      return "badge badge-malicious";
    case "INCONCLUSIVE":
      return "badge badge-inconclusive";
    default:
      return "badge badge-neutral";
  }
}

export function VerdictBadge({ value }: { value: Verdict | ScanStatus | null }) {
  return <span className={badgeClass(value)}>{LABELS[value ?? ""] ?? "—"}</span>;
}

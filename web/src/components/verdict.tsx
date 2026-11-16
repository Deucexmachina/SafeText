import type { ReactNode } from "react";
import { svgIcon } from "./SiteNav";

/* One source of truth for how verdicts look and read across the logged-in app.
   Every verdict carries an icon and a text label, so colour is never the only cue. */

export type VerdictKind = "safe" | "suspicious" | "malicious" | "inconclusive" | "running";

const IconSafe = ({ size = 18 }: { size?: number }) => svgIcon(size, <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m8.8 12.2 2.2 2.2 4.3-4.6" /></>);
const IconSuspicious = ({ size = 18 }: { size?: number }) => svgIcon(size, <><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4" /><path d="M12 17h.01" /></>);
const IconMalicious = ({ size = 18 }: { size?: number }) => svgIcon(size, <><path d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2l5.7-5.7Z" /><path d="m9 9 6 6M15 9l-6 6" /></>);
const IconInconclusive = ({ size = 18 }: { size?: number }) => svgIcon(size, <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.3-2.4 3.8" /><path d="M12 17h.01" /></>);
const IconRunning = ({ size = 18 }: { size?: number }) => svgIcon(size, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);

export const VERDICT_META: Record<VerdictKind, { label: string; Icon: (p: { size?: number }) => ReactNode; summary: string }> = {
  safe: { label: "Safe", Icon: IconSafe, summary: "No common scam signs found. Still be careful with links and requests for money." },
  suspicious: { label: "Suspicious", Icon: IconSuspicious, summary: "This message has some warning signs. Don't click or reply until you've checked with the sender another way." },
  malicious: { label: "Malicious", Icon: IconMalicious, summary: "This looks like a scam. Don't click links, reply, or send money." },
  inconclusive: { label: "Inconclusive", Icon: IconInconclusive, summary: "We couldn't reach a clear answer for this message." },
  running: { label: "Checking", Icon: IconRunning, summary: "This message is still being checked." },
};

export function verdictKind(value: string | null | undefined): VerdictKind {
  switch (value) {
    case "SAFE": return "safe";
    case "SUSPICIOUS": return "suspicious";
    case "MALICIOUS": return "malicious";
    case "RUNNING": return "running";
    default: return "inconclusive";
  }
}

export function VerdictTag({ kind, size = "md" }: { kind: VerdictKind; size?: "md" | "lg" }) {
  const { Icon, label } = VERDICT_META[kind];
  return <span className={`ap-tag ap-tag-${kind}${size === "lg" ? " ap-tag-lg" : ""}`}><Icon size={size === "lg" ? 20 : 15} />{label}</span>;
}

/* "Today, 3:36 PM" · "Yesterday, 9:05 AM" · "Nov 12, 4:10 PM" · "Dec 30, 2025, 8:00 AM" */
export function friendlyDate(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  return `${day}, ${time}`;
}

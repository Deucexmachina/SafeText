import type { ReactNode } from "react";
import { svgIcon } from "../../components/SiteNav";

/* Small shared pieces for the admin console. */

export const PAGE = 20;

export const Icons = {
  users: () => svgIcon(20, <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.9-3.6 3.4-5.5 6.5-5.5s5.6 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.8 3 2.6 3.5 5.2" /></>),
  scan: () => svgIcon(20, <><path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="m8.8 10.2 2.2 2.2 4.3-4.4" /></>),
  alert: (size = 18) => svgIcon(size, <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" /></>),
  info: () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5h.01" /></>),
  check: (size = 16) => svgIcon(size, <path d="m5 12.5 4.5 4.5L19 7.5" />),
  overview: () => svgIcon(18, <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>),
  audit: () => svgIcon(18, <><path d="M7 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5Z" /><path d="M9.5 11h6M9.5 14.5h6M9.5 18h3.5" /></>),
  globe: () => svgIcon(18, <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></>),
  flag: () => svgIcon(18, <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>),
  settings: () => svgIcon(18, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>),
  refresh: () => svgIcon(16, <><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20v-4h-4" /></>),
  download: () => svgIcon(16, <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>),
  search: () => svgIcon(18, <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>),
  trash: () => svgIcon(17, <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />),
  logout: () => svgIcon(16, <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l5-5-5-5" /><path d="M15 12H4" /></>),
  lock: () => svgIcon(16, <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>),
  unlock: () => svgIcon(16, <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" /></>),
  arrow: () => svgIcon(14, <path d="M5 12h14m-5-5 5 5-5 5" />),
};

export function fmt(date: string | null) {
  return date ? new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

/* Short relative form ("5 min ago", "3 days ago"); the full date goes in the title. */
export function ago(date: string | null) {
  if (!date) return "Never";
  const mins = Math.round((Date.now() - new Date(date).getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function Section({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="st-admin-section">
      <header className="st-admin-section-head">
        <div>
          <h2>{title}</h2>
          {description && <p className="ap-muted">{description}</p>}
        </div>
        {actions && <div className="st-admin-section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function ErrorAlert({ children }: { children: ReactNode }) {
  return <div className="ap-alert ap-alert-error" role="alert">{Icons.alert()}<span>{children}</span></div>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="st-admin-note">{Icons.info()}<span>{children}</span></p>;
}

export function Loading({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="st-admin-loading" aria-busy="true">
      <p role="status" className="visually-hidden">{label}</p>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="ap-skel-row" aria-hidden="true"><span /><span /><span /></div>)}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="st-admin-empty"><strong>{title}</strong>{children && <p className="ap-muted">{children}</p>}</div>;
}

/* Previous / Next paging for offset-based admin lists (the API returns up to PAGE rows). */
export function Pager({ offset, count, disabled, onPage, label }: { offset: number; count: number; disabled: boolean; onPage: (offset: number) => void; label: string }) {
  if (offset === 0 && count < PAGE) return null;
  const from = count ? offset + 1 : offset;
  return (
    <nav className="ap-pagination st-admin-pager" aria-label={label}>
      <button type="button" className="ap-page-btn" disabled={disabled || offset === 0} onClick={() => onPage(Math.max(0, offset - PAGE))}>‹ Previous</button>
      <span className="ap-muted">{count ? `Showing ${from}–${offset + count}` : "No more results"}</span>
      <button type="button" className="ap-page-btn" disabled={disabled || count < PAGE} onClick={() => onPage(offset + PAGE)}>Next ›</button>
    </nav>
  );
}

/* KPI tile: label, value, optional status line (icon + text, never colour alone). */
export function StatTile({ label, value, icon, tone, status }: { label: string; value: number; icon?: ReactNode; tone?: "warn" | "ok"; status?: string }) {
  return (
    <div className={`st-admin-stat${tone ? ` is-${tone}` : ""}`}>
      <div className="st-admin-stat-label">{icon}<span>{label}</span></div>
      <div className="st-admin-stat-value">{value.toLocaleString()}</div>
      {status && <div className="st-admin-stat-status">{tone === "warn" ? Icons.alert(14) : Icons.check(14)}<span>{status}</span></div>}
    </div>
  );
}

/* Ranked horizontal bars in one hue, largest first, value printed beside each bar.
   Rendered as a table so the numbers are readable without the bars. */
export function BarTable({ caption, nameLabel, valueLabel, rows, mono }: {
  caption: string; nameLabel: string; valueLabel: string; rows: { name: string; value: number }[]; mono?: boolean;
}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...sorted.map(r => r.value));
  return (
    <table className="st-admin-bars">
      <caption className="visually-hidden">{caption}</caption>
      <thead className="visually-hidden"><tr><th scope="col">{nameLabel}</th><th scope="col">{valueLabel}</th></tr></thead>
      <tbody>
        {sorted.map(r => (
          <tr key={r.name}>
            <th scope="row" className={mono ? "st-admin-mono" : undefined}>{r.name}</th>
            <td>
              <span className="st-admin-bar-track" aria-hidden="true"><span className="st-admin-bar" style={{ width: `${(r.value / max) * 100}%` }} /></span>
              <span className="st-admin-bar-value">{r.value.toLocaleString()}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

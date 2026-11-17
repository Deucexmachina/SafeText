import { useEffect, useState } from "react";
import type { AppStatus } from "../api";
import { svgIcon } from "./SiteNav";
import "../banner.css";

/* Site-wide bars shown right under the navbar:
   - Announcement (admin text): "info" (calm green) or "warning" (amber), closable.
     Closing is remembered per message, so a new announcement shows again.
   - Maintenance: amber, not closable, while new scans are paused. */

const DISMISS_KEY = "safetext:dismissed-announcement";

const IconMegaphone = () => svgIcon(16, <><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" /></>);
const IconAlert = () => svgIcon(16, <><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4" /><path d="M12 17h.01" /></>);
const IconWrench = () => svgIcon(16, <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.6-.6-.6-2.6 2.4-2.4Z" />);
const IconClose = () => svgIcon(16, <path d="M6 6l12 12M18 6 6 18" />);

export type BannerKind = "info" | "warning" | "maintenance";

/** One bar. Also used as the live preview in the admin Settings page. */
export function Banner({ kind, children, onDismiss }: { kind: BannerKind; children: React.ReactNode; onDismiss?: () => void }) {
  const label = kind === "maintenance" ? "Maintenance" : "Announcement";
  const icon = kind === "maintenance" ? <IconWrench /> : kind === "warning" ? <IconAlert /> : <IconMegaphone />;
  return (
    <div className={`st-banner st-banner-${kind === "info" ? "info" : "warn"}`} role="region" aria-label={label}>
      <div className="st-banner-inner">
        <span className="st-banner-icon" aria-hidden="true">{icon}</span>
        <p className="st-banner-text"><span className="st-banner-label">{label}</span>{children}</p>
        {onDismiss && (
          <button type="button" className="st-banner-close" aria-label={`Dismiss ${label.toLowerCase()}`} onClick={onDismiss}><IconClose /></button>
        )}
      </div>
    </div>
  );
}

function dismissedKey(status: AppStatus) {
  return `${status.announcementType ?? "info"}|${status.announcement}`;
}

function readDismissed(): string | null {
  try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
}

export function StatusBanners({ status }: { status: AppStatus | null }) {
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);
  const [now, setNow] = useState(() => Date.now());

  // Hide the announcement on time if its end passes while the page is open.
  const until = status?.announcementUntil ? Date.parse(status.announcementUntil) : NaN;
  useEffect(() => {
    if (Number.isNaN(until) || until <= now) return;
    const wait = Math.min(until - now + 500, 24 * 60 * 60 * 1000);
    const id = window.setTimeout(() => setNow(Date.now()), wait);
    return () => window.clearTimeout(id);
  }, [until, now]);

  if (!status) return null;
  const announcementLive = !!status.announcement && !(until <= now);
  const showAnnouncement = announcementLive && dismissed !== dismissedKey(status);

  function dismiss() {
    const key = dismissedKey(status!);
    try { localStorage.setItem(DISMISS_KEY, key); } catch { /* storage unavailable: hide for this visit only */ }
    setDismissed(key);
  }

  if (!status.maintenance && !showAnnouncement) return null;
  return (
    <div className="st-banners" aria-live="polite">
      {status.maintenance && (
        <Banner kind="maintenance">New scans are paused for now. Your history is still available.</Banner>
      )}
      {showAnnouncement && (
        <Banner kind={status.announcementType === "warning" ? "warning" : "info"} onDismiss={dismiss}>{status.announcement}</Banner>
      )}
    </div>
  );
}

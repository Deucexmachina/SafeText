import { useEffect, useState, type FormEvent } from "react";
import { getAdminSettings, saveAdminSettings, type AdminSettings } from "../../api";
import { ErrorAlert, Icons, Loading, Section } from "./ui";
import { Banner } from "../../components/StatusBanners";

/* <input type="datetime-local"> works in local time without a zone; the API stores ISO (UTC). */
const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (value: string): string | null => (value ? new Date(value).toISOString() : null);
const friendlyEnd = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// Ranges match what the server accepts; it still validates every save.
const SETTING_FIELDS: { key: "scansPer15Min" | "maxScansPerUser" | "scanRetentionDays" | "maxUploadMb"; label: string; unit: string; min: number; max: number; help: string }[] = [
  { key: "scansPer15Min", label: "Scans per 15 minutes", unit: "per account", min: 1, max: 200, help: "How often one account can submit scans." },
  { key: "maxScansPerUser", label: "Scans kept per account", unit: "scans", min: 1, max: 1000, help: "Oldest finished scans are removed past this." },
  { key: "scanRetentionDays", label: "Retention", unit: "days", min: 1, max: 3650, help: "Finished scans older than this are deleted." },
  { key: "maxUploadMb", label: "Max upload", unit: "MB", min: 1, max: 16, help: "Largest screenshot users can upload." },
];

export function Settings() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [saved, setSaved] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false; setLoading(true); setError(""); setSavedNotice(false);
    getAdminSettings().then(result => { if (!cancelled) { setSettings(result); setSaved(result); } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load settings."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !settings) return;
    setBusy(true); setError(""); setSavedNotice(false);
    try {
      const result = await saveAdminSettings({
        scansPer15Min: settings.scansPer15Min, maxScansPerUser: settings.maxScansPerUser,
        scanRetentionDays: settings.scanRetentionDays, maxUploadMb: settings.maxUploadMb,
        maintenance: settings.maintenance, announcement: settings.announcement,
        announcementType: settings.announcementType,
        // Only send the end time when it changed, so an already-passed one never blocks other saves.
        ...(settings.announcementUntil !== saved?.announcementUntil ? { announcementUntil: settings.announcementUntil } : {}),
      });
      setSettings(result); setSaved(result); setSavedNotice(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save settings."); }
    finally { setBusy(false); }
  }

  if (loading || !settings) return <Section title="Settings">{error ? <ErrorAlert>{error}</ErrorAlert> : <Loading label="Loading settings..." />}</Section>;

  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const outOfRange = (key: typeof SETTING_FIELDS[number]["key"], min: number, max: number) => {
    const v = settings[key];
    return !Number.isInteger(v) || v < min || v > max;
  };
  const untilChanged = settings.announcementUntil !== saved?.announcementUntil;
  const untilPast = settings.announcementUntil !== null && Date.parse(settings.announcementUntil) <= Date.now();
  const untilTooLate = settings.announcementUntil !== null && Date.parse(settings.announcementUntil) > Date.now() + 366 * 86_400_000;
  const untilInvalid = untilChanged && (untilPast || untilTooLate);
  const invalid = SETTING_FIELDS.some(f => outOfRange(f.key, f.min, f.max)) || untilInvalid;
  const update = (patch: Partial<AdminSettings>) => { setSettings({ ...settings, ...patch }); setSavedNotice(false); };

  return (
    <Section title="Settings" description="Changes apply to everyone as soon as you save.">
      <form className="ad-settings" onSubmit={submit} noValidate>
        <fieldset className="ap-card ad-panel">
          <legend className="ad-legend"><h3>Limits</h3></legend>
          <div className="ad-settings-grid">
            {SETTING_FIELDS.map(({ key, label, unit, min, max, help }) => {
              const bad = outOfRange(key, min, max);
              return (
                <div className="ad-field" key={key}>
                  <label htmlFor={`set-${key}`} className="ad-label">{label}</label>
                  <div className="ad-number">
                    <input id={`set-${key}`} className="ad-input" type="number" inputMode="numeric" min={min} max={max}
                      value={Number.isNaN(settings[key]) ? "" : settings[key]} aria-invalid={bad || undefined} aria-describedby={`set-${key}-help`}
                      onChange={e => update({ [key]: e.target.value === "" ? NaN : Number(e.target.value) } as Partial<AdminSettings>)} />
                    <span className="ad-unit">{unit}</span>
                  </div>
                  <p id={`set-${key}-help`} className={`ad-help${bad ? " is-bad" : ""}`}>
                    {bad && Icons.alert(14)}{bad ? `Enter a whole number from ${min} to ${max.toLocaleString()}.` : `${help} (${min}–${max.toLocaleString()})`}
                  </p>
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="ap-card ad-panel">
          <legend className="ad-legend"><h3>Announcement banner</h3></legend>
          <div className="ad-field">
            <label htmlFor="set-announcement" className="ad-label">Message</label>
            <input id="set-announcement" className="ad-input" type="text" maxLength={500} placeholder="Shown to everyone who visits SafeText"
              value={settings.announcement} aria-describedby="set-announcement-help" onChange={e => update({ announcement: e.target.value })} />
            <p id="set-announcement-help" className="ad-help">Leave empty to hide the banner. {settings.announcement.length}/500</p>
          </div>

          <div className="ad-announce-grid">
            <fieldset className="ad-field ad-seg">
              <legend className="ad-label">Type</legend>
              <div className="ad-seg-row">
                <label className={settings.announcementType === "info" ? "is-on is-ok" : ""}>
                  <input type="radio" name="announcement-type" value="info" checked={settings.announcementType === "info"} onChange={() => update({ announcementType: "info" })} />
                  {Icons.info()}Information
                </label>
                <label className={settings.announcementType === "warning" ? "is-on is-warn" : ""}>
                  <input type="radio" name="announcement-type" value="warning" checked={settings.announcementType === "warning"} onChange={() => update({ announcementType: "warning" })} />
                  {Icons.alert(16)}Warning
                </label>
              </div>
              <p className="ad-help">Information is calm green. Warning is amber, for things people must notice.</p>
            </fieldset>

            <div className="ad-field">
              <label htmlFor="set-announcement-until" className="ad-label">Show until <span className="ad-optional">(optional)</span></label>
              <div className="ad-until-row">
                <input id="set-announcement-until" className="ad-input" type="datetime-local" min={toLocalInput(new Date().toISOString())}
                  value={toLocalInput(settings.announcementUntil)} aria-invalid={untilInvalid || undefined} aria-describedby="set-announcement-until-help"
                  onChange={e => update({ announcementUntil: fromLocalInput(e.target.value) })} />
                {settings.announcementUntil && <button type="button" className="ad-btn" onClick={() => update({ announcementUntil: null })}>Clear</button>}
              </div>
              <p id="set-announcement-until-help" className={`ad-help${untilInvalid || (untilPast && !untilChanged) ? " is-bad" : ""}`}>
                {untilInvalid
                  ? <>{Icons.alert(14)}{untilPast ? "Pick a time in the future." : "Pick a time within the next year."}</>
                  : untilPast
                    ? <>{Icons.alert(14)}This end time has passed, so people no longer see the announcement. Set a new time or clear it.</>
                    : settings.announcementUntil
                      ? `Hidden automatically after ${friendlyEnd(settings.announcementUntil)}.`
                      : "Leave empty to show it until you remove it."}
              </p>
            </div>
          </div>

          {settings.announcement.trim() && <div className="ad-preview" aria-label="Banner preview">
            <span className="ad-preview-label">Preview</span>
            <div className="st-banner-preview">
              <Banner kind={settings.announcementType} onDismiss={() => undefined}>{settings.announcement}</Banner>
            </div>
            <p className="ad-help">Shown under the navbar on every page. People can close it with ✕; a new message shows again.</p>
          </div>}
        </fieldset>

        <fieldset className="ap-card ad-panel">
          <legend className="ad-legend"><h3>Maintenance mode</h3></legend>
          <label className="ad-switch-row">
            <input type="checkbox" role="switch" className="ad-switch-input" checked={settings.maintenance} onChange={e => update({ maintenance: e.target.checked })} />
            <span className="ad-switch" aria-hidden="true" />
            <span><strong>Maintenance mode — pause all new scans</strong><span className="ap-muted ad-sub">Users see a maintenance notice and can't submit messages until you turn this off.</span></span>
          </label>
          {settings.maintenance && <div className="ap-alert ap-alert-warn">{Icons.alert()}<span>New scans will be paused for everyone once you save.</span></div>}
        </fieldset>

        {error && <ErrorAlert>{error}</ErrorAlert>}

        <div className={`ad-savebar${dirty ? " is-dirty" : ""}`}>
          <span className="ad-savebar-status" role="status">
            {savedNotice && !dirty ? <>{Icons.check()}Settings saved.</> : dirty ? "You have unsaved changes." : "All changes saved."}
          </span>
          <div className="ad-savebar-actions">
            {dirty && <button type="button" className="lp-btn lp-btn-secondary lp-btn-sm" disabled={busy} onClick={() => { setSettings(saved); setError(""); }}>Discard</button>}
            <button className="lp-btn lp-btn-primary lp-btn-sm" type="submit" disabled={busy || !dirty || invalid} aria-busy={busy}>
              {busy ? <><span className="lp-spinner" aria-hidden="true" />Saving...</> : "Save settings"}
            </button>
          </div>
        </div>
      </form>
    </Section>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { svgIcon, type Theme } from "./SiteNav";

const IconScan = () => svgIcon(22, <><path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="m8.8 10.2 2.2 2.2 4.3-4.4" /></>);
const IconHistory = () => svgIcon(22, <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v4h4" /><path d="M12 8v4.5l3 2" /></>);
const IconAdmin = () => svgIcon(22, <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" /><circle cx="12" cy="10.5" r="2.2" /><path d="M8.5 16c.8-1.6 2-2.4 3.5-2.4s2.7.8 3.5 2.4" /></>);
const IconChevron = () => svgIcon(16, <path d="m6 9 6 6 6-6" />);
const IconMoon = () => svgIcon(18, <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />);
const IconSun = () => svgIcon(18, <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
const IconLogout = () => svgIcon(18, <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l5-5-5-5" /><path d="M15 12H4" /></>);

type Tab = { to: string; label: string; Icon: () => JSX.Element; end?: boolean };

function tabsFor(isAdmin: boolean): Tab[] {
  const tabs: Tab[] = [
    { to: "/", label: "Scan", Icon: IconScan, end: true },
    { to: "/history", label: "History", Icon: IconHistory },
  ];
  if (isAdmin) tabs.push({ to: "/admin", label: "Admin", Icon: IconAdmin });
  return tabs;
}

const tabClass = (base: string) => ({ isActive }: { isActive: boolean }) => (isActive ? `${base} is-active` : base);

export function AppNav({ email, isAdmin, theme, onToggleTheme, showThemeToggle, onSignOut }: {
  email: string;
  isAdmin: boolean;
  theme: Theme;
  onToggleTheme: () => void;
  showThemeToggle: boolean;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const tabs = tabsFor(isAdmin);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (e.target instanceof Node && !menu.current?.contains(e.target)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    try { await onSignOut(); }
    finally { setSigningOut(false); }
  }

  return (
    <>
      <header className="lp-nav ap-nav">
        <div className="lp-wrap lp-nav-inner">
          <Link to="/" className="lp-logo"><span className="lp-logo-tile"><img src="/icon.png" alt="" /></span>SafeText</Link>
          <nav aria-label="Main" className="ap-tabs">
            {tabs.map(t => <NavLink key={t.to} to={t.to} end={t.end} className={tabClass("ap-tab")}>{t.label}</NavLink>)}
          </nav>

          <div className="ap-account" ref={menu} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
            <button ref={toggle} type="button" className="ap-account-btn" aria-expanded={open} aria-controls="account-menu"
              aria-label={`Account menu for ${email}`} onClick={() => setOpen(o => !o)}>
              <span className="ap-avatar" aria-hidden="true">{email.charAt(0).toUpperCase()}</span>
              <span className="ap-account-email" aria-hidden="true">{email}</span>
              <IconChevron />
            </button>
            <div id="account-menu" className="ap-account-menu" hidden={!open}>
              <p className="ap-account-who">Signed in as<strong>{email}</strong></p>
              {showThemeToggle && (
                <button type="button" className="ap-menu-item" aria-pressed={theme === "dark"} onClick={onToggleTheme}>
                  {theme === "dark" ? <IconSun /> : <IconMoon />}<span>Dark mode</span>
                  <span className="ap-switch" aria-hidden="true" />
                </button>
              )}
              <button type="button" className="ap-menu-item ap-menu-logout" disabled={signingOut} aria-busy={signingOut} onClick={() => void signOut()}>
                {signingOut ? <span className="lp-spinner" aria-hidden="true" /> : <IconLogout />}
                <span>{signingOut ? "Logging out…" : "Log out"}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Phones: tabs sit at the bottom, within thumb reach. */}
      <nav aria-label="Main (mobile)" className="ap-bottom-tabs">
        {tabs.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={tabClass("ap-bottom-tab")}>
            <Icon /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

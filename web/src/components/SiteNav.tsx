import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

/* Shared public-site chrome: the landing page and the password-recovery
   flow use this same navbar, logo and light/dark theme preference. */

export type AuthMode = "login" | "register";
export type Theme = "light" | "dark";

const THEME_KEY = "safetext:theme";

function readTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}

export function useSiteTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => { try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ } }, [theme]);
  return [theme, () => setTheme(t => (t === "dark" ? "light" : "dark"))];
}

export type TextSize = number; // zoom percentage, 100–150
const TEXT_KEY = "safetext:text";
export const TEXT_MIN = 100;
export const TEXT_MAX = 150;

function readTextSize(): TextSize {
  try {
    const stored = localStorage.getItem(TEXT_KEY);
    if (stored === "large") return 120; // migrate the old on/off preference
    const value = Number(stored);
    return Number.isFinite(value) ? Math.min(TEXT_MAX, Math.max(TEXT_MIN, Math.round(value))) : TEXT_MIN;
  } catch { return TEXT_MIN; }
}

export function useTextSize(): [TextSize, (size: number) => void] {
  const [size, setSize] = useState<TextSize>(readTextSize);
  useEffect(() => {
    document.documentElement.style.zoom = size === TEXT_MIN ? "" : `${size}%`;
    try { localStorage.setItem(TEXT_KEY, String(size)); } catch { /* storage unavailable */ }
  }, [size]);
  return [size, setSize];
}

export const svgIcon = (size: number, children: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);
const IconMenu = ({ open }: { open: boolean }) => svgIcon(22, open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />);
const IconMoon = () => svgIcon(18, <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />);
const IconSun = () => svgIcon(18, <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);

export function Logo({ href }: { href: string }) {
  const inner = <><span className="lp-logo-tile"><img src="/icon.png" alt="" /></span>SafeText</>;
  return href.startsWith("#")
    ? <a href={href} className="lp-logo">{inner}</a>
    : <Link to={href} className="lp-logo">{inner}</Link>;
}

const SECTIONS = [
  { id: "how-it-works", label: "How it works" },
  { id: "common-scams", label: "Common scams" },
  { id: "faq", label: "FAQ" },
];

/** On the landing page pass `onAuth` to open the dialog in place; elsewhere
 *  the auth buttons link to `/?auth=…`, which the landing page opens on load. */
export function SiteNav({ theme, onToggleTheme, onAuth }: {
  theme: Theme;
  onToggleTheme: () => void;
  onAuth?: (mode: AuthMode) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const home = !!onAuth;
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const sectionHref = (id: string) => (home ? `#${id}` : `/#${id}`);
  const authButton = (mode: AuthMode, className: string, label: string) => onAuth
    ? <button type="button" className={className} onClick={() => { setMenuOpen(false); onAuth(mode); }}>{label}</button>
    : <Link to={`/?auth=${mode}`} className={className} onClick={() => setMenuOpen(false)}>{label}</Link>;
  const themeToggle = (
    <button type="button" className="lp-theme" aria-pressed={theme === "dark"} onClick={onToggleTheme}>
      {theme === "dark" ? <IconSun /> : <IconMoon />}<span>Dark mode</span>
    </button>
  );

  return (
    <>
      <a className="lp-skip" href="#main-content">Skip to content</a>
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-inner">
          <Logo href={home ? "#top" : "/"} />
          <nav aria-label="Main" className="lp-nav-links">
            {SECTIONS.map(s => <a key={s.id} href={sectionHref(s.id)}>{s.label}</a>)}
          </nav>
          <div className="lp-nav-actions">
            <span className="lp-desktop-only">{themeToggle}</span>
            {authButton("login", "lp-btn lp-btn-ghost lp-nav-login", "Log in")}
            {authButton("register", "lp-btn lp-btn-primary lp-btn-sm", "Sign up")}
            <button type="button" className="lp-burger" aria-expanded={menuOpen} aria-controls="lp-menu" aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen(o => !o)}>
              <IconMenu open={menuOpen} />
            </button>
          </div>
        </div>
        <div id="lp-menu" className="lp-menu" hidden={!menuOpen}>
          <nav aria-label="Mobile" className="lp-wrap">
            {SECTIONS.map(s => <a key={s.id} href={sectionHref(s.id)} onClick={() => setMenuOpen(false)}>{s.label}</a>)}
            {authButton("login", "lp-btn lp-btn-secondary", "Log in")}
            {themeToggle}
          </nav>
        </div>
      </header>
    </>
  );
}

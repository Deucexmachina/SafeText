import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ScanPage } from "./pages/ScanPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ScanDetailPage } from "./pages/ScanDetailPage";
import { useEffect, useState } from "react";
import { ApiError, currentUser, getStatus, logout, type AppStatus, type User } from "./api";
import { AuthPage } from "./pages/AuthPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { AdminPage } from "./pages/AdminPage";
import { LandingPage } from "./pages/LandingPage";
import { AppNav } from "./components/AppNav";
import { useSiteTheme } from "./components/SiteNav";
import "./landing.css";
import "./app.css";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<AppStatus | null>(null);
  useEffect(() => { getStatus().then(setStatus).catch(() => {}); }, []);
  async function loadSession() {
    setLoading(true); setError("");
    try { setUser((await currentUser()).user); }
    catch (err) { if (!(err instanceof ApiError && err.status === 401)) setError("Couldn't reach the server. Check that the backend and database are running."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void loadSession();
    const expired = () => { setUser(null); setError(""); };
    window.addEventListener("safetext:session-expired", expired);
    return () => window.removeEventListener("safetext:session-expired", expired);
  }, []);
  async function signOut(): Promise<boolean> {
    try { await logout(); setUser(null); setError(""); return true; }
    catch { setError("Couldn't log out. Please try again."); return false; }
  }
  return (
    <BrowserRouter>
      <Shell user={user} loading={loading} error={error} status={status} onLogin={setUser} onRetry={loadSession} onSignOut={signOut} />
    </BrowserRouter>
  );
}

function Shell({ user, loading, error, status, onLogin, onRetry, onSignOut }: {
  user: User | null;
  loading: boolean;
  error: string;
  status: AppStatus | null;
  onLogin: (user: User) => void;
  onRetry: () => void;
  onSignOut: () => Promise<boolean>;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useSiteTheme();

  // When the server ends the session (an admin forced a logout, the account was
  // disabled, or it expired), send the person to the landing page with the login
  // dialog open, instead of leaving them on a page they can no longer use.
  useEffect(() => {
    const ended = () => navigate("/?auth=login&reason=session", { replace: true });
    window.addEventListener("safetext:session-expired", ended);
    return () => window.removeEventListener("safetext:session-expired", ended);
  }, [navigate]);

  // An idle tab makes no requests, so re-check the session when the person comes
  // back to it (at most every 30 seconds) to catch a forced logout promptly.
  useEffect(() => {
    if (!user) return;
    let lastCheck = Date.now();
    const recheck = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheck < 30_000) return;
      lastCheck = Date.now();
      currentUser().catch(err => {
        if (err instanceof ApiError && err.status === 401) window.dispatchEvent(new Event("safetext:session-expired"));
      });
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("focus", recheck);
    return () => { document.removeEventListener("visibilitychange", recheck); window.removeEventListener("focus", recheck); };
  }, [user]);
  const notices = <>
    {status?.maintenance && <p className="notice banner" role="status">SafeText is under maintenance — new scans are paused. Please check back soon.</p>}
    {status?.announcement && <p className="notice banner" role="status">{status.announcement}</p>}
    {error && <p role="alert" className="error-box">{error} {!user && <button className="link-btn" onClick={onRetry}>Retry</button>}</p>}
  </>;

  // Logged-out visitors on the home page see the public landing page.
  // Login and sign-up open there in a dialog that reuses AuthPage.
  // The password-recovery flow shares the landing page's navbar and styling.
  if (!loading && !user && (pathname === "/" || pathname === "/forgot-password")) {
    const hasNotice = Boolean(status?.maintenance || status?.announcement || error);
    const pageNotices = hasNotice ? notices : undefined;
    return pathname === "/"
      ? <LandingPage onLogin={onLogin} notices={pageNotices} />
      : <ForgotPasswordPage notices={pageNotices} />;
  }

  // Initial session check: a calm branded loading screen instead of bare text.
  if (loading) {
    return <div className="lp ap ap-loading" data-theme={theme} role="status">
      <span className="lp-logo-tile ap-loading-logo"><img src="/icon.png" alt="" /></span>
      <span className="lp-spinner" aria-hidden="true" />
      <span>Loading your account…</span>
    </div>;
  }

  if (user) {
    // Logging out always returns to the landing page, from any screen.
    const signOutToLanding = async () => { if (await onSignOut()) navigate("/", { replace: true }); };
    const adminRoute = pathname.startsWith("/admin");
    return <div className="lp ap" data-theme={theme}>
      <a className="lp-skip" href="#main-content">Skip to content</a>
      <AppNav key={user.id} email={user.email} isAdmin={user.role === "admin"} theme={theme} onToggleTheme={toggleTheme}
        showThemeToggle onSignOut={signOutToLanding} />
      <main id="main-content" tabIndex={-1} className={adminRoute ? "ap-main ap-main-admin" : "ap-main"}>
        {(status?.maintenance || status?.announcement || error) && <div className="ap-notices">{notices}</div>}
        <Routes key={user.id}>
          <Route path="/" element={<ScanPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/scan/:id" element={<ScanDetailPage />} />
          <Route path="/forgot-password" element={<Navigate to="/" replace />} />
          <Route path="/admin" element={user.role === 'admin' ? <AdminPage /> : <Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>;
  }

  return <>
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="wordmark">
          <img src="/icon.png" alt="" className="wordmark-icon" />
          SafeText
        </Link>
      </div>
    </header>
    <main>
      {notices}
      {!error && <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="*" element={<AuthPage onLogin={onLogin} />} />
      </Routes>}
    </main>
  </>;
}

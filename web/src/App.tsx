import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ScanPage } from "./pages/ScanPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ScanDetailPage } from "./pages/ScanDetailPage";
import { useEffect, useState } from "react";
import { ApiError, currentUser, getStatus, logout, type AppStatus, type User } from "./api";
import { AuthPage } from "./pages/AuthPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { AdminPage } from "./pages/AdminPage";
import { LandingPage } from "./pages/LandingPage";
import { NavigationMenu } from "./components/NavigationMenu";

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
  async function signOut() {
    try { await logout(); setUser(null); setError(""); }
    catch { setError("Couldn't log out. Please try again."); }
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
  onSignOut: () => void;
}) {
  const { pathname } = useLocation();
  const notices = <>
    {status?.maintenance && <p className="notice banner" role="status">SafeText is under maintenance — new scans are paused. Please check back soon.</p>}
    {status?.announcement && <p className="notice banner" role="status">{status.announcement}</p>}
    {error && <p role="alert" className="error-box">{error} {!user && <button className="link-btn" onClick={onRetry}>Retry</button>}</p>}
  </>;

  // Logged-out visitors on the home page see the public landing page.
  // Login and sign-up open there in a dialog that reuses AuthPage.
  if (!loading && !user && pathname === "/") {
    const hasNotice = Boolean(status?.maintenance || status?.announcement || error);
    return <LandingPage onLogin={onLogin} notices={hasNotice ? notices : undefined} />;
  }

  return <>
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="wordmark">
          <img src="/icon.png" alt="" className="wordmark-icon" />
          SafeText
        </Link>
        {user && <NavigationMenu key={user.id} isAdmin={user.role === "admin"} />}
        {user && <div className="account"><span>{user.email}</span><button className="link-btn" onClick={onSignOut}>Log out</button></div>}
      </div>
    </header>
    <main>
      {notices}
      {loading ? <p>Loading your account...</p> : !user ? (!error && <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="*" element={<AuthPage onLogin={onLogin} />} />
      </Routes>) : <Routes key={user.id}>
        <Route path="/" element={<ScanPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/scan/:id" element={<ScanDetailPage />} />
        <Route path="/forgot-password" element={<Navigate to="/" replace />} />
        <Route path="/admin" element={user.role === 'admin' ? <AdminPage /> : <Navigate to="/" replace />} />
      </Routes>}
    </main>
  </>;
}

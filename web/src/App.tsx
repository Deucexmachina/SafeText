import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router-dom";
import { ScanPage } from "./pages/ScanPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ScanDetailPage } from "./pages/ScanDetailPage";
import { useEffect, useState } from "react";
import { ApiError, currentUser, logout, type User } from "./api";
import { AuthPage } from "./pages/AuthPage";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="wordmark">
            SafeText
          </Link>
          {user && <nav>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Scan
            </NavLink>
            <NavLink
              to="/history"
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              History
            </NavLink>
          </nav>}
          {user && <div className="account"><span>{user.email}</span><button className="link-btn" onClick={signOut}>Log out</button></div>}
        </div>
      </header>
      <main>
        {error && <p role="alert" className="error-box">{error} {!user && <button className="link-btn" onClick={loadSession}>Retry</button>}</p>}
        {loading ? <p>Loading your account...</p> : !user ? (!error && <AuthPage onLogin={setUser} />) : <Routes key={user.id}>
          <Route path="/" element={<ScanPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/scan/:id" element={<ScanDetailPage />} />
        </Routes>}
      </main>
    </BrowserRouter>
  );
}

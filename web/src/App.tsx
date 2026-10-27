import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router-dom";
import { ScanPage } from "./pages/ScanPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ScanDetailPage } from "./pages/ScanDetailPage";

export default function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="wordmark">
            SafeText
          </Link>
          <nav>
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
          </nav>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<ScanPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/scan/:id" element={<ScanDetailPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

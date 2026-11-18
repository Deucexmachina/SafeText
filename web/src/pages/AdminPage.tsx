import { useRef, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Overview } from "./admin/Overview";
import { Accounts } from "./admin/Accounts";
import { Audit } from "./admin/Audit";
import { Domains } from "./admin/Domains";
import { Reports } from "./admin/Reports";
import { Settings } from "./admin/Settings";
import { Icons } from "./admin/ui";
import "../admin.css";

const VIEWS = [
  { id: "overview", label: "Overview", icon: Icons.overview, Panel: Overview },
  { id: "accounts", label: "Accounts", icon: Icons.users, Panel: Accounts },
  { id: "audit", label: "Audit log", icon: Icons.audit, Panel: Audit },
  { id: "domains", label: "Domains", icon: Icons.globe, Panel: Domains },
  { id: "reports", label: "Reports", icon: Icons.flag, Panel: Reports },
  { id: "settings", label: "Settings", icon: Icons.settings, Panel: Settings },
] as const;
type ViewId = typeof VIEWS[number]["id"];

export function AdminPage() {
  // The open section lives in the URL (?tab=accounts) so refresh and Back keep your place.
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const view: ViewId = VIEWS.some(v => v.id === requested) ? requested as ViewId : "overview";
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = VIEWS.find(v => v.id === view)!;

  const select = (id: ViewId) => setParams(id === "overview" ? {} : { tab: id }, { replace: true });

  // Arrow keys / Home / End move between tabs (WAI-ARIA tabs pattern).
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: VIEWS.length - 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const next = (keys[e.key] + VIEWS.length) % VIEWS.length;
    select(VIEWS[next].id);
    tabs.current[next]?.focus();
  }

  return (
    <div className="st-admin">
      <header className="ap-page-head st-admin-head">
        <h1>Admin console</h1>
        <p className="ap-lead">Manage accounts, review reports and keep SafeText running. Each person's messages and scan history remain private.</p>
      </header>

      <div className="st-admin-layout">
        <div className="st-admin-nav" role="tablist" aria-label="Admin sections" aria-orientation="vertical">
          {VIEWS.map((v, i) => (
            <button key={v.id} ref={el => { tabs.current[i] = el; }} type="button" role="tab" id={`tab-${v.id}`}
              aria-selected={view === v.id} aria-controls={`panel-${v.id}`} tabIndex={view === v.id ? 0 : -1}
              className="st-admin-nav-item" onClick={() => select(v.id)} onKeyDown={e => onKeyDown(e, i)}>
              {v.icon()}<span>{v.label}</span>
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`} className="st-admin-panel-area" key={view}>
          <current.Panel />
        </div>
      </div>
    </div>
  );
}

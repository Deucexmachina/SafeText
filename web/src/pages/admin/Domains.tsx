import { useEffect, useMemo, useState, type FormEvent } from "react";
import { addDomain, listDomains, removeDomain, type DomainRule } from "../../api";
import { Empty, ErrorAlert, Icons, Loading, Section, ago, fmt } from "./ui";

type ListFilter = "all" | "block" | "allow";

export function Domains() {
  const [domains, setDomains] = useState<DomainRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [list, setList] = useState<"block" | "allow">("block");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<ListFilter>("all");

  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    listDomains().then(result => { if (!cancelled) setDomains(result.rows); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load domains."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const rule = await addDomain(draft.trim(), list);
      setDomains(current => [...current.filter(d => d.domain !== rule.domain), rule]
        .sort((a, b) => a.list === b.list ? a.domain.localeCompare(b.domain) : a.list.localeCompare(b.list)));
      setDraft("");
      setNotice(`${rule.domain} added to the ${rule.list === "block" ? "blocklist" : "allowlist"}. It applies to new scans.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not add the domain."); }
    finally { setBusy(false); }
  }

  async function remove(domain: string) {
    if (busy) return;
    setBusy(true); setRemoving(domain); setError(""); setNotice("");
    try { await removeDomain(domain); setDomains(current => current.filter(d => d.domain !== domain)); setNotice(`${domain} removed.`); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not remove the domain."); }
    finally { setBusy(false); setRemoving(null); }
  }

  const counts = { all: domains.length, block: domains.filter(d => d.list === "block").length, allow: domains.filter(d => d.list === "allow").length };
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return domains.filter(d => (show === "all" || d.list === show) && (!q || d.domain.includes(q)));
  }, [domains, query, show]);

  return (
    <Section title="Domains" description="Blocklisted domains are always flagged; allowlisted domains are never flagged. Subdomains are included.">
      <form className="ap-card st-admin-domain-form" onSubmit={submit}>
        <div className="st-admin-field">
          <label htmlFor="domain-input" className="st-admin-label">Domain</label>
          <input id="domain-input" className="st-admin-input st-admin-mono" type="text" placeholder="gcash.com" autoComplete="off" spellCheck={false}
            value={draft} onChange={e => setDraft(e.target.value)} />
        </div>
        <fieldset className="st-admin-field st-admin-seg">
          <legend className="st-admin-label">Add to</legend>
          <div className="st-admin-seg-row">
            <label className={list === "block" ? "is-on is-bad" : ""}><input type="radio" name="list" value="block" checked={list === "block"} onChange={() => setList("block")} />{Icons.lock()}Blocklist</label>
            <label className={list === "allow" ? "is-on is-ok" : ""}><input type="radio" name="list" value="allow" checked={list === "allow"} onChange={() => setList("allow")} />{Icons.check(15)}Allowlist</label>
          </div>
        </fieldset>
        <button className="lp-btn lp-btn-primary st-admin-domain-add" type="submit" disabled={busy || !draft.trim()} aria-busy={busy && !removing}>
          {busy && !removing ? <span className="lp-spinner" aria-hidden="true" /> : null}Add domain
        </button>
      </form>

      {error && <ErrorAlert>{error}</ErrorAlert>}
      {notice && <p className="ap-alert ap-alert-info" role="status">{Icons.check()}<span>{notice}</span></p>}

      <div className="ap-card st-admin-table-card">
        <div className="ap-toolbar">
          <div className="ap-search">
            <label htmlFor="domain-search" className="visually-hidden">Search domains</label>
            {Icons.search()}
            <input id="domain-search" type="search" placeholder="Search domains" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="ap-filters" role="group" aria-label="Show list">
            {(["all", "block", "allow"] as ListFilter[]).map(f => (
              <button key={f} type="button" className="ap-filter" aria-pressed={show === f} onClick={() => setShow(f)}>
                {f === "all" ? "All" : f === "block" ? "Blocked" : "Allowed"} <span className="st-admin-count">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>
        {loading ? <Loading label="Loading domains..." /> : !domains.length ? (
          <Empty title="No domains yet.">Adding a domain to a list applies to new scans.</Empty>
        ) : !visible.length ? <Empty title="No domains match." /> : (
          <ul className="st-admin-domains">
            {visible.map(rule => (
              <li key={rule.domain}>
                <span className="st-admin-mono st-admin-domain">{rule.domain}</span>
                <span className={`st-admin-pill ${rule.list === "block" ? "is-bad" : "is-ok"}`}>{rule.list === "block" ? Icons.lock() : Icons.check(14)}{rule.list === "block" ? "Blocked" : "Allowed"}</span>
                <span className="ap-muted st-admin-sub" title={fmt(rule.created_at)}>Added {ago(rule.created_at)}</span>
                <button type="button" className="st-admin-btn" disabled={busy} aria-busy={removing === rule.domain}
                  aria-label={`Remove ${rule.domain}`} onClick={() => void remove(rule.domain)}>
                  {removing === rule.domain ? <span className="lp-spinner" aria-hidden="true" /> : Icons.trash()}<span>Remove</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

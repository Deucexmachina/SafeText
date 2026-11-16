import { pool } from "../db/pool.js";
import { hostnameOf } from "./extract.js";
import type { ThreatIntelResult, UrlThreatResult } from "./types.js";

export const MANUAL_BLOCK = "MANUAL_BLOCK";

// Normalizes operator input like "https://www.Gcash.com/login" to "gcash.com".
export function normalizeDomain(input: string): string {
  const host = hostnameOf(input.trim()) ?? input.trim().toLowerCase().replace(/^www\./, "").split("/")[0];
  return host.split("/")[0];
}

function matches(set: Set<string>, host: string | null): boolean {
  if (!host) return false;
  for (const domain of set) if (host === domain || host.endsWith(`.${domain}`)) return true;
  return false;
}

// Applies the admin-curated lists to whatever threat intel exists. A missing
// provider result does not shield a blocklisted domain: the lists alone can
// still flag it. Allowlisted domains have provider threats removed.
export async function applyDomainLists(urls: string[], intel: ThreatIntelResult | null): Promise<ThreatIntelResult | null> {
  const { rows } = await pool.query<{ domain: string; list: "block" | "allow" }>("SELECT domain, list FROM domain_lists");
  if (!rows.length) return intel;
  const block = new Set(rows.filter(r => r.list === "block").map(r => r.domain));
  const allow = new Set(rows.filter(r => r.list === "allow").map(r => r.domain));
  if (!intel) {
    const flagged = urls.map<UrlThreatResult>(url => ({ url, threat: matches(block, hostnameOf(url)) ? MANUAL_BLOCK : null }));
    return flagged.some(u => u.threat) ? { urls: flagged } : null;
  }
  return {
    urls: intel.urls.map(entry => {
      const host = hostnameOf(entry.url);
      if (matches(block, host)) return { ...entry, threat: MANUAL_BLOCK };
      if (matches(allow, host)) return { ...entry, threat: null };
      return entry;
    }),
  };
}

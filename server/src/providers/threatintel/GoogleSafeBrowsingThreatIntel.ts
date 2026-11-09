import type { ThreatIntelResult, ThreatType } from "../../domain/types.js";
import type { UrlThreatIntel } from "./UrlThreatIntel.js";
import {
  assertOk,
  ProviderError,
  ProviderGuard,
  type ProviderGuardOptions,
} from "../resilience.js";

const PROVIDER = "Google Safe Browsing";
const DEFAULT_BASE_URL = "https://safebrowsing.googleapis.com/v4";

const THREAT_TYPES: ThreatType[] = [
  "MALWARE",
  "SOCIAL_ENGINEERING",
  "UNWANTED_SOFTWARE",
];

interface ThreatMatch {
  threatType?: string;
  threat?: { url?: string };
}

export interface GoogleSafeBrowsingOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  guard?: Partial<ProviderGuardOptions>;
}

// Checks URLs against Google Safe Browsing Lookup API v4 (threatMatches:find).
export class GoogleSafeBrowsingThreatIntel implements UrlThreatIntel {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly guard: ProviderGuard;

  constructor(opts: GoogleSafeBrowsingOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.guard = new ProviderGuard(PROVIDER, opts.guard);
  }

  async lookup(urls: string[]): Promise<ThreatIntelResult> {
    if (urls.length === 0) return { urls: [] };
    if (!this.apiKey) {
      throw new ProviderError(
        PROVIDER,
        "GOOGLE_SAFE_BROWSING_API_KEY is not configured; add it to server/.env",
      );
    }

    const res = await this.guard.run(async (signal) => {
      const r = await this.fetchImpl(
        `${this.baseUrl}/threatMatches:find?key=${this.apiKey}`,
        {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client: { clientId: "safetext", clientVersion: "1.0.0" },
            threatInfo: {
              threatTypes: THREAT_TYPES,
              platformTypes: ["ANY_PLATFORM"],
              threatEntryTypes: ["URL"],
              threatEntries: urls.map((url) => ({ url })),
            },
          }),
        },
      );
      assertOk(PROVIDER, r);
      try { return await r.json() as unknown; }
      catch { throw new ProviderError(PROVIDER, "returned an unreadable response"); }
    });

    const body = res;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProviderError(PROVIDER, "returned an invalid threat response");
    const matches = (
      body as { matches?: ThreatMatch[] }
    )?.matches;
    const byUrl = new Map<string, ThreatType>();
    if (matches !== undefined && !Array.isArray(matches)) throw new ProviderError(PROVIDER, "returned invalid threat matches");
    if (Array.isArray(matches)) {
      for (const m of matches) {
        const url = m?.threat?.url;
        const threat = m?.threatType;
        if (typeof url !== "string" || !THREAT_TYPES.includes(threat as ThreatType)) throw new ProviderError(PROVIDER, "returned an invalid threat match");
        if (
          typeof url === "string" &&
          THREAT_TYPES.includes(threat as ThreatType) &&
          !byUrl.has(url)
        ) {
          byUrl.set(url, threat as ThreatType);
        }
      }
    }

    return {
      urls: urls.map((url) => ({ url, threat: byUrl.get(url) ?? null })),
    };
  }
}

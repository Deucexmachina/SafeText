import type { ThreatIntelResult } from "../../domain/types.js";

// Reputation lookup for URLs found in a message.
export interface UrlThreatIntel {
  lookup(urls: string[]): Promise<ThreatIntelResult>;
}

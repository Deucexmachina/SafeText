import type { ThreatIntelResult, UrlThreatResult } from "../../domain/types.js";
import type { UrlThreatIntel } from "./UrlThreatIntel.js";
import { hostnameOf } from "../../domain/extract.js";
import { BRANDS, hostIsOfficial } from "../../domain/brands.js";
import { sleep } from "../../lib/sleep.js";

const RISKY_TLDS = new Set([
  "top", "xyz", "click", "link", "loan", "win", "bid", "icu", "buzz", "cam",
  "rest", "quest", "monster", "zip", "mov", "country", "kim", "science",
  "work", "support", "live", "vip", "pw", "tk", "ml", "ga", "cf", "gq",
]);

const SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "cutt.ly", "rebrand.ly", "rb.gy", "goo.gl",
  "is.gd", "buff.ly", "ow.ly", "s.id", "t.co", "shorturl.at", "tiny.cc",
]);

const PHISHY_HOST_KEYWORDS =
  /verify|login|signin|secure|update|billing|support|account|confirm|alert|claim|free|bonus|wallet|reward|suspend|unlock/;

const IP_HOST_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function classifyUrl(url: string): UrlThreatResult["threat"] {
  const host = hostnameOf(url);
  if (!host) return null;
  if (IP_HOST_RE.test(host)) return "SOCIAL_ENGINEERING";
  if (SHORTENERS.has(host)) return "SOCIAL_ENGINEERING";

  const tld = host.split(".").pop() ?? "";
  if (RISKY_TLDS.has(tld)) return "SOCIAL_ENGINEERING";

  // Brand lookalike: contains the brand name but is not an official domain.
  for (const brand of BRANDS) {
    if (hostIsOfficial(host, brand)) return null;
    if (brand.aliases.some((a) => host.includes(a))) {
      return "SOCIAL_ENGINEERING";
    }
  }

  if (PHISHY_HOST_KEYWORDS.test(host)) return "SOCIAL_ENGINEERING";
  return null;
}

export class StubUrlThreatIntel implements UrlThreatIntel {
  async lookup(urls: string[]): Promise<ThreatIntelResult> {
    await sleep(250);
    return { urls: urls.map((url) => ({ url, threat: classifyUrl(url) })) };
  }
}

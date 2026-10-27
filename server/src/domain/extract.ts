// Lightweight entity extraction shared by the analyzer and threat-intel stubs.

const KNOWN_TLDS = new Set([
  "com", "net", "org", "info", "biz", "app", "dev", "io", "co", "me", "ph",
  "pro", "name", "shop", "store", "site", "online", "live", "vip", "top",
  "xyz", "click", "link", "loan", "win", "bid", "icu", "buzz", "cam", "rest",
  "quest", "monster", "zip", "mov", "work", "support", "country", "kim",
  "science", "pw", "tk", "ml", "ga", "cf", "gq", "cc", "asia", "mobi",
  "us", "uk", "de", "ru", "cn", "in", "au", "ca", "sg", "my", "id", "vn",
  "th", "ly", "at", "to", "is", "gl",
]);

const EXPLICIT_URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const DOMAIN_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b(?:\/[^\s<>"')]*)?/gi;

const TRAILING_JUNK = /[.,;:!?()\[\]{}"']+$/;

function clean(match: string): string {
  return match.replace(TRAILING_JUNK, "");
}

export function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  const covered: string[] = [];

  for (const m of text.matchAll(EXPLICIT_URL_RE)) {
    const url = clean(m[0]);
    if (url.length > 4) {
      urls.add(url);
      covered.push(m[0]);
    }
  }

  // Bare domains like "gcash-verify.top" with no scheme — skip ones already
  // captured inside a full URL.
  for (const m of text.matchAll(DOMAIN_RE)) {
    const candidate = clean(m[0]);
    const host = candidate.split("/")[0];
    const tld = host.split(".").pop() ?? "";
    if (!KNOWN_TLDS.has(tld)) continue;
    if (covered.some((c) => c.includes(candidate))) continue;
    if (/\S+@\S+/.test(candidate)) continue; // don't flag emails as domains
    urls.add(candidate);
  }
  return [...urls];
}

export function hostnameOf(url: string): string | null {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const PHONE_RE = /\+?\d[\d\s().-]{7,14}\d/g;

export function extractPhoneNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PHONE_RE)) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) continue;
    // Skip things that look like tracking/parcel numbers adjacent to # or letters
    const idx = m.index ?? 0;
    if (idx > 0 && /[#A-Za-z]/.test(text[idx - 1])) continue;
    out.add(raw);
  }
  return [...out];
}

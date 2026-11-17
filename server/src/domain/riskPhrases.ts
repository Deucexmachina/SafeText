import { extractPhoneNumbers, extractUrls } from "./extract.js";

// Phrases that drive scam verdicts, matched case-insensitively. The matched
// substrings (not the pattern names) are returned so the UI can highlight the
// exact words inside the original message.
const PATTERNS = [
  /account (?:will be|has been|is) (?:locked|suspended|blocked|limited|deactivated)/gi,
  /\b(?:verify|confirm|update|validate) your (?:account|identity|details|information)\b/gi,
  /\bclick (?:the |this |here )?link\b/gi,
  /\btap (?:the |this |here )?link\b/gi,
  /\bclaim (?:now|your prize|it now|your reward|here)\b/gi,
  /\byou (?:have )?won\b/gi,
  /\bwinner\b/gi,
  /\bcongratulations\b/gi,
  /\burgent\b/gi,
  /\bact now\b/gi,
  /\bexpires? (?:today|soon|in \d+ hours?)\b/gi,
  /\blimited (?:time|slots?)\b/gi,
  /\bone[\s-]?time (?:pin|password)\b/gi,
  /\botp\b/g,
  /\bsend (?:money|cash|payment)\b/gi,
  /\btransfer (?:now|immediately|payment)\b/gi,
  /\bprocessing fee\b/gi,
  /\bdelivery fee\b/gi,
  /\bcustoms fee\b/gi,
  /\bfree (?:load|data|prize|iphone|money)\b/gi,
];

// Unique matched substrings, longest first, capped so highlighting stays useful.
export function findRiskyParts(text: string): { phrases: string[]; links: string[] } {
  const found = new Set<string>();
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) found.add(match[0]);
  }
  const phrases = [...found].sort((a, b) => b.length - a.length).slice(0, 20);
  const links = [...new Set([...extractUrls(text), ...extractPhoneNumbers(text)])];
  return { phrases, links };
}

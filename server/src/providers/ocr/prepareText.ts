import { ProviderError } from '../resilience.js';

export const OCR_TEXT_VERSION = 1;
const RESULT_NOTE = 'This screenshot included a SafeText result page. Only the text under “Message checked” was analyzed; the previous verdict, account details, and page controls were excluded.';
const AMBIGUOUS = 'The screenshot includes a result page, but its message could not be isolated reliably. Crop to the original SMS or paste its text.';

function layout(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\f/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000E-\u001F\u200B\uFEFF]/g, '')
    // LLMWhisperer's default page delimiter is metadata, not SMS content.
    .replace(/(?:^|\n)[ \t]*<<<[ \t]*(?=\n|$)/g, '\n')
    .replace(/\s*<<<\s*$/, '')
    .split('\n').map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Conservative cleanup of OCR text; never infer missing words or a sender. */
export function prepareOcrText(raw: string): { text: string; note: string | null } {
  const text = layout(raw);
  const looksLikeResult = /^SafeText\b/i.test(text) && /\bConfidence\s+\d{1,3}\b/i.test(text)
    && /\b(?:WHY|DETAILS\s+FOUND|MESSAGE\s+CHECKED)\b/i.test(text);
  if (!looksLikeResult) return { text, note: null };

  const headings = [...text.matchAll(/\bMESSAGE\s+CHECKED\b/gi)];
  if (headings.length !== 1) throw new ProviderError('Text extraction', AMBIGUOUS);
  const heading = headings[0];
  const header = text.slice(0, heading.index);
  if (!/\bLog\s*out\b[\s\S]*\bConfidence\s+\d{1,3}\b[\s\S]*\bWHY\b[\s\S]*\bDETAILS\s+FOUND\b/i.test(header)) {
    throw new ProviderError('Text extraction', AMBIGUOUS);
  }
  // Require the app's scan ID, date, and time. A bare "Scan" in an SMS is not a boundary.
  const footers = [...text.matchAll(/\bScan\s+scn_[0-9A-HJKMNP-TV-Z]{26}\s*[·•]\s*(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}|\d{4}-\d{2}-\d{2})[,\s]+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?/gi)];
  if (footers.length !== 1 || footers[0].index! <= heading.index!) throw new ProviderError('Text extraction', AMBIGUOUS);
  const footer = footers[0];
  const trailing = text.slice(footer.index! + footer[0].length).trim();
  if (trailing && !/^Check\s+another\s+message$/i.test(trailing)) throw new ProviderError('Text extraction', AMBIGUOUS);
  const message = layout(text.slice(heading.index! + heading[0].length, footer.index));
  if (!message || /^SafeText\b/i.test(message)) throw new ProviderError('Text extraction', AMBIGUOUS);
  return { text: message, note: RESULT_NOTE };
}

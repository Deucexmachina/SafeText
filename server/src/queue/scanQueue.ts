import { getScan, saveExtraction, saveResult, setState } from "../db/scans.js";
import { analyzer, ocr, threatIntel } from "../providers/index.js";
import { extractUrls } from "../domain/extract.js";
import { combineScanResults } from "../domain/verdicts.js";
import { ProviderError } from "../providers/resilience.js";

const services = { getScan, setState, saveExtraction, saveResult, ocr, analyzer, threatIntel };
export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B\uFEFF]/g, "").trim();
}
function safeError(err: unknown, fallback: string): string {
  return err instanceof ProviderError ? err.message : fallback;
}

// In-process FIFO queue. QUEUED -> EXTRACTING -> ANALYZING -> terminal.
const pending: string[] = [];
let draining = false;

export function enqueueScan(id: string): void {
  pending.push(id);
  void drain();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (pending.length > 0) {
      const id = pending.shift()!;
      await processScan(id).catch((err) =>
        console.error(`scan ${id} failed:`, err),
      );
    }
  } finally {
    draining = false;
  }
}

export async function processScan(id: string, dependencies = services): Promise<void> {
  const { getScan, setState, saveExtraction, saveResult, ocr, analyzer, threatIntel } = dependencies;
  const row = await getScan(id);
  if (!row || row.state !== "QUEUED") return;

  // EXTRACTING
  const trustedExtraction = row.extracted_text !== null && (row.input_type === "text" || row.extraction_source === "llmwhisperer_v2");
  await setState(id, row.input_type === "image" && !trustedExtraction ? "EXTRACTING" : "ANALYZING");
  let text: string;
  let senderId: string | null = null;
  try {
    if (trustedExtraction) {
      // Resume after restart without consuming one-time OCR output again.
      text = row.extracted_text!;
      senderId = row.sender_id;
    } else if (row.input_type === "text") {
      text = row.input_text ?? "";
    } else {
      if (!row.image_bytes?.length) throw new ProviderError("LLMWhisperer", "the original screenshot is no longer available; upload it again for a fresh OCR scan");
      const o = await ocr.extract({
        bytes: row.image_bytes ?? Buffer.alloc(0),
        mimeType: row.image_mime ?? "application/octet-stream",
      });
      text = o.text;
      senderId = o.senderId;
    }
    // Persist one-time OCR output immediately, including empty output, and
    // release screenshot bytes before any analysis or validation can fail.
    await saveExtraction(id, text, senderId);
    row.image_bytes = null;
    text = normalizeText(text);
    if (!/[\p{L}\p{N}]/u.test(text)) throw new ProviderError("Text extraction", row.input_type === "image"
      ? "the screenshot could not be read; upload a clearer screenshot or paste the SMS text"
      : "no readable SMS text was supplied; paste the message including its words or numbers");
    if (text.length > 10_000) throw new ProviderError("Text extraction", "message exceeds 10,000 characters; crop the screenshot to the SMS");
  } catch (err) {
    await saveResult(id, {
      state: "INCONCLUSIVE",
      analysis: null,
      threatIntel: null,
      incomplete: ["extraction", "analysis", "threat_intel"],
      error: safeError(err, "Text extraction failed; try a clearer screenshot or paste the SMS text."),
    });
    return;
  }

  // ANALYZING (saveExtraction already moved the state to ANALYZING)
  const [aRes] = await Promise.allSettled([analyzer.analyze({ text, senderId })]);
  // Merge local candidates with model entities; local extraction keeps link
  // checking available even if Kimi fails or omits a URL.
  const urls = [...new Set([...extractUrls(text), ...(aRes.status === "fulfilled" ? aRes.value.entities.urls : [])])];
  const [tRes] = await Promise.allSettled([threatIntel.lookup(urls)]);

  const { state, analysis, threatIntel: intel, incomplete } =
    combineScanResults(
      aRes.status === "fulfilled" ? aRes.value : null,
      tRes.status === "fulfilled" ? tRes.value : null,
      text,
      senderId,
    );

  await saveResult(id, {
    state,
    analysis,
    threatIntel: intel,
    incomplete,
    error: [
      ...(aRes.status === "rejected" ? [safeError(aRes.reason, "Kimi analysis failed; try again later.")] : []),
      ...(tRes.status === "rejected" ? [safeError(tRes.reason, "Google Safe Browsing link check failed; try again later.")] : []),
    ].join(" ") || null,
  });
}

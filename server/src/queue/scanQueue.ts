import { getScan, saveExtraction, saveResult, setState } from "../db/scans.js";
import { analyzer, ocr, threatIntel } from "../providers/index.js";
import { extractUrls } from "../domain/extract.js";
import { combineScanResults } from "../domain/verdicts.js";

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

async function processScan(id: string): Promise<void> {
  const row = await getScan(id);
  if (!row || row.state !== "QUEUED") return;

  // EXTRACTING
  await setState(id, "EXTRACTING");
  let text: string;
  let senderId: string | null = null;
  try {
    if (row.input_type === "text") {
      text = row.input_text ?? "";
    } else {
      const o = await ocr.extract({
        bytes: row.image_bytes ?? Buffer.alloc(0),
        mimeType: row.image_mime ?? "application/octet-stream",
      });
      text = o.text;
      senderId = o.senderId;
    }
    if (!text.trim()) throw new Error("no text could be extracted");
    await saveExtraction(id, text, senderId);
  } catch (err) {
    await saveResult(id, {
      state: "INCONCLUSIVE",
      analysis: null,
      threatIntel: null,
      incomplete: ["extraction", "analysis", "threat_intel"],
      error: err instanceof Error ? err.message : "extraction failed",
    });
    return;
  }

  // ANALYZING (saveExtraction already moved the state to ANALYZING)
  const [aRes, tRes] = await Promise.allSettled([
    analyzer.analyze({ text, senderId }),
    threatIntel.lookup(extractUrls(text)),
  ]);

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
    error:
      aRes.status === "rejected"
        ? `analysis: ${aRes.reason}`
        : tRes.status === "rejected"
          ? `threat_intel: ${tRes.reason}`
          : null,
  });
}

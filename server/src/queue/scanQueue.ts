import { getScan, saveExtraction, saveResult, setState } from "../db/scans.js";
import { analyzer, ocr, threatIntel } from "../providers/index.js";
import { extractUrls, hostnameOf } from "../domain/extract.js";
import type { AnalysisResult, Stage, ThreatIntelResult } from "../domain/types.js";

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

  const incomplete: Stage[] = [];
  let analysis: AnalysisResult | null =
    aRes.status === "fulfilled" ? aRes.value : null;
  const intel: ThreatIntelResult | null =
    tRes.status === "fulfilled" ? tRes.value : null;
  if (!analysis) incomplete.push("analysis");
  if (!intel) incomplete.push("threat_intel");

  // A flagged URL escalates an otherwise-safe verdict.
  const flagged = intel?.urls.find((u) => u.threat);
  if (analysis?.verdict === "SAFE" && flagged) {
    analysis = {
      ...analysis,
      verdict: "SUSPICIOUS",
      confidence: Math.max(analysis.confidence, 60),
      reasons: [
        `Flagged by threat intelligence (${hostnameOf(flagged.url) ?? flagged.url}: ${flagged.threat})`,
        ...analysis.reasons,
      ].slice(0, 5),
    };
  }

  const state = !analysis ? "INCONCLUSIVE" : incomplete.length ? "PARTIAL" : "COMPLETE";
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

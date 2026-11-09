import type {
  AnalysisResult,
  Stage,
  ThreatIntelResult,
} from "./types.js";
import {
  extractPhoneNumbers,
  extractUrls,
  hostnameOf,
} from "./extract.js";

export interface CombinedScanResult {
  state: "COMPLETE" | "PARTIAL" | "INCONCLUSIVE";
  analysis: AnalysisResult | null;
  threatIntel: ThreatIntelResult | null;
  incomplete: Stage[];
}

// Merges analyzer output with threat-intel into the final stored result.
// A flagged URL forces MALICIOUS with confidence >= 90, even when the
// analyzer itself failed or judged the text safe.
export function combineScanResults(
  analysis: AnalysisResult | null,
  intel: ThreatIntelResult | null,
  text: string,
  senderId: string | null,
): CombinedScanResult {
  const incomplete: Stage[] = [];
  if (!analysis) incomplete.push("analysis");
  if (!intel) incomplete.push("threat_intel");

  const flagged = intel?.urls.find((u) => u.threat);
  if (flagged) {
    const host = hostnameOf(flagged.url) ?? flagged.url;
    const reason = `Flagged by Google Safe Browsing (${host}: ${flagged.threat})`;
    if (analysis) {
      analysis = {
        ...analysis,
        verdict: "MALICIOUS",
        confidence: Math.max(analysis.confidence, 90),
        reasons: [reason, ...analysis.reasons].slice(0, 5),
      };
    } else {
      analysis = {
        verdict: "MALICIOUS",
        confidence: 90,
        reasons: [
          reason,
          "Message analysis was unavailable; verdict is based on threat intelligence.",
        ],
        entities: {
          senderId,
          urls: extractUrls(text),
          phoneNumbers: extractPhoneNumbers(text),
        },
      };
    }
  }

  // A clean URL lookup cannot compensate for a failed required check.
  if (analysis?.verdict === "SAFE" && incomplete.length) {
    analysis = { ...analysis, verdict: "INCONCLUSIVE", confidence: 0,
      reasons: ["Required checks could not finish; this message cannot be confirmed safe.", ...analysis.reasons] };
  }

  const state = !analysis
    ? "INCONCLUSIVE"
    : incomplete.length
      ? "PARTIAL"
      : "COMPLETE";
  return { state, analysis, threatIntel: intel, incomplete };
}

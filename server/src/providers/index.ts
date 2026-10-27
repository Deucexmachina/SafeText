import type { OcrProvider } from "./ocr/OcrProvider.js";
import type { ScamAnalyzer } from "./analyzer/ScamAnalyzer.js";
import type { UrlThreatIntel } from "./threatintel/UrlThreatIntel.js";
import { StubOcrProvider } from "./ocr/StubOcrProvider.js";
import { StubScamAnalyzer } from "./analyzer/StubScamAnalyzer.js";
import { StubUrlThreatIntel } from "./threatintel/StubUrlThreatIntel.js";

// Stub adapters for now. To go live, construct the real provider here using
// the keys in config (LLM_WHISPERER_API_KEY, KIMI_API_KEY,
// GOOGLE_SAFE_BROWSING_API_KEY) — nothing else in the app changes.
export const ocr: OcrProvider = new StubOcrProvider();
export const analyzer: ScamAnalyzer = new StubScamAnalyzer();
export const threatIntel: UrlThreatIntel = new StubUrlThreatIntel();

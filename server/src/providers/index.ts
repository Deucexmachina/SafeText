import { config } from "../config.js";
import type { OcrProvider } from "./ocr/OcrProvider.js";
import type { ScamAnalyzer } from "./analyzer/ScamAnalyzer.js";
import type { UrlThreatIntel } from "./threatintel/UrlThreatIntel.js";
import { StubOcrProvider } from "./ocr/StubOcrProvider.js";
import { KimiScamAnalyzer } from "./analyzer/KimiScamAnalyzer.js";
import { GoogleSafeBrowsingThreatIntel } from "./threatintel/GoogleSafeBrowsingThreatIntel.js";

// OCR is still stubbed. Scam analysis (Kimi) and URL threat intelligence
// (Google Safe Browsing) are live providers configured via server/.env;
// a missing key makes only that provider's calls fail with a clear error.
export const ocr: OcrProvider = new StubOcrProvider();
export const analyzer: ScamAnalyzer = new KimiScamAnalyzer({
  apiKey: config.kimiApiKey,
  model: config.kimiModel,
});
export const threatIntel: UrlThreatIntel = new GoogleSafeBrowsingThreatIntel({
  apiKey: config.safeBrowsingApiKey,
});

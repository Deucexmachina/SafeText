import { config } from "../config.js";
import type { OcrProvider } from "./ocr/OcrProvider.js";
import type { ScamAnalyzer } from "./analyzer/ScamAnalyzer.js";
import type { UrlThreatIntel } from "./threatintel/UrlThreatIntel.js";
import { LlmWhispererOcrProvider } from "./ocr/LlmWhispererOcrProvider.js";
import { KimiScamAnalyzer } from "./analyzer/KimiScamAnalyzer.js";
import { GoogleSafeBrowsingThreatIntel } from "./threatintel/GoogleSafeBrowsingThreatIntel.js";

export const ocr: OcrProvider = new LlmWhispererOcrProvider({
  apiKey: config.llmWhispererApiKey,
  baseUrl: config.llmWhispererBaseUrl,
});
export const analyzer: ScamAnalyzer = new KimiScamAnalyzer({
  apiKey: config.kimiApiKey,
  model: config.kimiModel,
});
export const threatIntel: UrlThreatIntel = new GoogleSafeBrowsingThreatIntel({
  apiKey: config.safeBrowsingApiKey,
});

import type { OcrResult } from "../../domain/types.js";

// Extracts the SMS text (and sender ID, when visible) from a screenshot.
export interface OcrProvider {
  extract(input: { bytes: Buffer; mimeType: string }): Promise<OcrResult>;
}

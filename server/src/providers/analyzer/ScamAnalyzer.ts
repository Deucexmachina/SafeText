import type { AnalysisResult } from "../../domain/types.js";

// Judges an extracted SMS text and returns a strict-JSON verdict.
export interface ScamAnalyzer {
  analyze(input: {
    text: string;
    senderId?: string | null;
  }): Promise<AnalysisResult>;
}

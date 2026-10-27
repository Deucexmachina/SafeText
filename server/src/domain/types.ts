export type InputType = "text" | "image";

// Internal job state machine: QUEUED -> EXTRACTING -> ANALYZING -> terminal
export type JobState =
  | "QUEUED"
  | "EXTRACTING"
  | "ANALYZING"
  | "COMPLETE"
  | "PARTIAL"
  | "INCONCLUSIVE";

// Status exposed by the API (internal in-progress states collapse to RUNNING)
export type ScanStatus = "RUNNING" | "COMPLETE" | "PARTIAL" | "INCONCLUSIVE";

export type Verdict = "SAFE" | "SUSPICIOUS" | "MALICIOUS" | "INCONCLUSIVE";

export type Stage = "extraction" | "analysis" | "threat_intel";

export type ThreatType =
  | "SOCIAL_ENGINEERING"
  | "MALWARE"
  | "UNWANTED_SOFTWARE";

export interface Entities {
  senderId: string | null;
  urls: string[];
  phoneNumbers: string[];
}

export interface AnalysisResult {
  verdict: Verdict;
  confidence: number;
  reasons: string[];
  entities: Entities;
}

export interface UrlThreatResult {
  url: string;
  threat: ThreatType | null;
}

export interface ThreatIntelResult {
  urls: UrlThreatResult[];
}

export interface OcrResult {
  text: string;
  senderId: string | null;
  confidence: number;
}

export interface ScanResultDto {
  scanId: string;
  status: ScanStatus;
  extraction: { text: string } | null;
  analysis: AnalysisResult | null;
  threatIntel: ThreatIntelResult | null;
  incomplete: Stage[];
  createdAt: string;
}

export interface ScanSummaryDto {
  scanId: string;
  status: ScanStatus;
  inputType: InputType;
  verdict: Verdict | null;
  confidence: number | null;
  preview: string | null;
  createdAt: string;
}

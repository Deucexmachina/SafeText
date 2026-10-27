import type {
  AnalysisResult,
  InputType,
  JobState,
  ScanResultDto,
  ScanStatus,
  ScanSummaryDto,
  Stage,
  ThreatIntelResult,
} from "../domain/types.js";
import { pool } from "./pool.js";

export interface ScanRow {
  id: string;
  state: JobState;
  input_type: InputType;
  input_text: string | null;
  image_hash: string | null;
  image_mime: string | null;
  image_bytes: Buffer | null;
  extracted_text: string | null;
  sender_id: string | null;
  analysis: AnalysisResult | null;
  threat_intel: ThreatIntelResult | null;
  incomplete: Stage[];
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface NewScan {
  id: string;
  inputType: InputType;
  inputText?: string;
  imageHash?: string;
  imageMime?: string;
  imageBytes?: Buffer;
}

export async function createScan(scan: NewScan): Promise<void> {
  await pool.query(
    `INSERT INTO scans (id, input_type, input_text, image_hash, image_mime, image_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      scan.id,
      scan.inputType,
      scan.inputText ?? null,
      scan.imageHash ?? null,
      scan.imageMime ?? null,
      scan.imageBytes ?? null,
    ],
  );
}

export async function findIdByImageHash(hash: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM scans WHERE image_hash = $1`,
    [hash],
  );
  return rows[0]?.id ?? null;
}

export async function getScan(id: string): Promise<ScanRow | null> {
  const { rows } = await pool.query<ScanRow>(`SELECT * FROM scans WHERE id = $1`, [
    id,
  ]);
  return rows[0] ?? null;
}

export async function listScans(limit: number): Promise<ScanRow[]> {
  const { rows } = await pool.query<ScanRow>(
    `SELECT * FROM scans ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function setState(id: string, state: JobState): Promise<void> {
  await pool.query(
    `UPDATE scans SET state = $2, updated_at = now() WHERE id = $1`,
    [id, state],
  );
}

export async function saveExtraction(
  id: string,
  text: string,
  senderId: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE scans
       SET extracted_text = $2, sender_id = $3, state = 'ANALYZING', updated_at = now()
     WHERE id = $1`,
    [id, text, senderId],
  );
}

export interface FinalResult {
  state: "COMPLETE" | "PARTIAL" | "INCONCLUSIVE";
  analysis: AnalysisResult | null;
  threatIntel: ThreatIntelResult | null;
  incomplete: Stage[];
  error?: string | null;
}

export async function saveResult(id: string, r: FinalResult): Promise<void> {
  await pool.query(
    `UPDATE scans
       SET state = $2, analysis = $3, threat_intel = $4, incomplete = $5,
           error = $6, updated_at = now()
     WHERE id = $1`,
    [
      id,
      r.state,
      r.analysis ? JSON.stringify(r.analysis) : null,
      r.threatIntel ? JSON.stringify(r.threatIntel) : null,
      JSON.stringify(r.incomplete),
      r.error ?? null,
    ],
  );
}

// Re-queue scans left mid-flight by a restart; returns their ids.
export async function resetStuckScans(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE scans SET state = 'QUEUED', updated_at = now()
      WHERE state IN ('QUEUED', 'EXTRACTING', 'ANALYZING')
      RETURNING id`,
  );
  return rows.map((r) => r.id);
}

const PUBLIC_STATUS: Record<JobState, ScanStatus> = {
  QUEUED: "RUNNING",
  EXTRACTING: "RUNNING",
  ANALYZING: "RUNNING",
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  INCONCLUSIVE: "INCONCLUSIVE",
};

export function toDto(row: ScanRow): ScanResultDto {
  return {
    scanId: row.id,
    status: PUBLIC_STATUS[row.state],
    extraction: row.extracted_text ? { text: row.extracted_text } : null,
    analysis: row.analysis,
    threatIntel: row.threat_intel,
    incomplete: row.incomplete ?? [],
    createdAt: row.created_at.toISOString(),
  };
}

export function toSummary(row: ScanRow): ScanSummaryDto {
  const text = row.extracted_text ?? row.input_text;
  return {
    scanId: row.id,
    status: PUBLIC_STATUS[row.state],
    inputType: row.input_type,
    verdict: row.analysis?.verdict ?? null,
    confidence: row.analysis?.confidence ?? null,
    preview: text ? text.slice(0, 90) : null,
    createdAt: row.created_at.toISOString(),
  };
}

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
import type { PoolClient } from 'pg';
import { HttpError } from '../http/problem.js';

async function checkScanCapacity(client: PoolClient, userId: string): Promise<void> {
  // All admissions share this transaction lock, avoiding check/insert races.
  await client.query('SELECT pg_advisory_xact_lock(1935763001)');
  const { rows } = await client.query<{ total: number; owned: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE user_id = $1)::int AS owned
     FROM scans WHERE state IN ('QUEUED', 'EXTRACTING', 'ANALYZING')`, [userId]);
  if (rows[0].owned >= 3 || rows[0].total >= 100) throw new HttpError(429, 'Scan queue busy', 'Wait for current scans to finish before submitting another message.');
}

export interface ScanRow {
  id: string;
  state: JobState;
  input_type: InputType;
  input_text: string | null;
  image_hash: string | null;
  image_mime: string | null;
  image_bytes: Buffer | null;
  extracted_text: string | null;
  extraction_source: string | null;
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
  userId: string;
  inputType: InputType;
  inputText?: string;
  imageHash?: string;
  imageMime?: string;
  imageBytes?: Buffer;
}

export async function createScan(scan: NewScan): Promise<void> {
  const client = await pool.connect();
  try {
  await client.query('BEGIN');
  await checkScanCapacity(client, scan.userId);
  await client.query(
    `INSERT INTO scans (id, input_type, input_text, image_hash, image_mime, image_bytes, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      scan.id,
      scan.inputType,
      scan.inputText ?? null,
      scan.imageHash ?? null,
      scan.imageMime ?? null,
      scan.imageBytes ?? null,
      scan.userId,
    ],
  );
  await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

export async function findIdByImageHash(hash: string, userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM scans WHERE image_hash = $1 AND user_id = $2`,
    [hash, userId],
  );
  return rows[0]?.id ?? null;
}

// Retrying a failed scan reuses stored one-time OCR text when available.
// Concurrent repeat uploads cannot enqueue two new OCR jobs.
export async function retryImageScan(id: string, bytes: Buffer): Promise<boolean> {
  const client = await pool.connect();
  try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(1935763001)');
  const candidate = await client.query<{ user_id: string }>(
    `SELECT user_id FROM scans WHERE id = $1 AND input_type = 'image' AND
      (state IN ('PARTIAL', 'INCONCLUSIVE') OR (state = 'COMPLETE' AND extraction_source IS DISTINCT FROM 'llmwhisperer_v2')) FOR UPDATE`, [id]);
  if (!candidate.rows[0]) { await client.query('COMMIT'); return false; }
  await checkScanCapacity(client, candidate.rows[0].user_id);
  const result = await client.query(
    `UPDATE scans SET state = 'QUEUED', analysis = NULL, threat_intel = NULL,
       incomplete = '[]'::jsonb, error = NULL, updated_at = now(),
       extracted_text = CASE WHEN extraction_source IS DISTINCT FROM 'llmwhisperer_v2' OR incomplete ? 'extraction' THEN NULL ELSE NULLIF(extracted_text, '') END,
       sender_id = CASE WHEN extraction_source IS DISTINCT FROM 'llmwhisperer_v2' THEN NULL ELSE sender_id END,
       image_bytes = CASE WHEN extraction_source IS DISTINCT FROM 'llmwhisperer_v2' OR incomplete ? 'extraction' OR NULLIF(extracted_text, '') IS NULL THEN $2::bytea ELSE NULL END
     WHERE id = $1 AND input_type = 'image' AND
       (state IN ('PARTIAL', 'INCONCLUSIVE') OR
        (state = 'COMPLETE' AND extraction_source IS DISTINCT FROM 'llmwhisperer_v2')) RETURNING id`,
    [id, bytes],
  );
  await client.query('COMMIT');
  return !!result.rowCount;
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

export async function getScan(id: string): Promise<ScanRow | null> {
  const { rows } = await pool.query<ScanRow>(`SELECT * FROM scans WHERE id = $1`, [
    id,
  ]);
  return rows[0] ?? null;
}

export async function getUserScan(id: string, userId: string): Promise<ScanRow | null> {
  const { rows } = await pool.query<ScanRow>("SELECT * FROM scans WHERE id = $1 AND user_id = $2", [id, userId]);
  return rows[0] ?? null;
}

export async function deleteUserScan(id: string, userId: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM scans WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]);
  return !!result.rowCount;
}

export async function listScans(limit: number, userId: string): Promise<ScanRow[]> {
  const { rows } = await pool.query<ScanRow>(
    `SELECT * FROM scans WHERE user_id = $2 ORDER BY created_at DESC LIMIT $1`,
    [limit, userId],
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
       SET extracted_text = $2, sender_id = $3, image_bytes = NULL,
           extraction_source = CASE WHEN input_type = 'image' THEN 'llmwhisperer_v2' ELSE 'text' END,
           state = 'ANALYZING', updated_at = now()
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
           error = $6, image_bytes = NULL, updated_at = now()
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
  const legacyImage = row.input_type === 'image' && !!row.extracted_text && row.extraction_source !== 'llmwhisperer_v2';
  return {
    scanId: row.id,
    progress: ["QUEUED", "EXTRACTING", "ANALYZING"].includes(row.state) ? row.state as "QUEUED" | "EXTRACTING" | "ANALYZING" : null,
    error: legacyImage ? "This older screenshot scan used unverified sample extraction. Upload the screenshot again to read its actual text with LLMWhisperer." : row.error,
    status: legacyImage ? 'INCONCLUSIVE' : PUBLIC_STATUS[row.state],
    extraction: !legacyImage && row.extracted_text ? { text: row.extracted_text } : null,
    analysis: legacyImage ? null : row.analysis,
    threatIntel: legacyImage ? null : row.threat_intel,
    incomplete: legacyImage ? ['extraction', 'analysis', 'threat_intel'] : row.incomplete ?? [],
    createdAt: row.created_at.toISOString(),
  };
}

export function toSummary(row: ScanRow): ScanSummaryDto {
  const dto = toDto(row);
  const text = dto.extraction?.text ?? (row.input_type === 'text' ? row.input_text : null);
  return {
    scanId: row.id,
    status: dto.status,
    inputType: row.input_type,
    verdict: dto.analysis?.verdict ?? null,
    confidence: dto.analysis?.confidence ?? null,
    preview: text ? text.slice(0, 90) : null,
    createdAt: row.created_at.toISOString(),
  };
}

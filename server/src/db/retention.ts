import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { HttpError } from '../http/problem.js';
import { pool } from './pool.js';

const terminal = "state IN ('COMPLETE', 'PARTIAL', 'INCONCLUSIVE')";
// Shared with scan admission so concurrent submissions cannot bypass storage caps.
export const scanAdmissionLock = 1935763001;

async function pruneScans(client: PoolClient): Promise<void> {
  await client.query(`DELETE FROM scans WHERE ${terminal} AND created_at < now() - $1 * interval '1 day'`, [config.scanRetentionDays]);
  // Never leave screenshot bytes attached to completed/legacy scans.
  await client.query(`UPDATE scans SET image_bytes = NULL WHERE ${terminal} AND image_bytes IS NOT NULL`);
  await client.query(`DELETE FROM scans WHERE id IN (
    SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS position
      FROM scans WHERE ${terminal}) ranked WHERE position > $1)`, [config.maxScansPerUser]);
  await client.query(`DELETE FROM scans WHERE id IN (
    SELECT id FROM scans WHERE ${terminal} ORDER BY created_at DESC, id DESC OFFSET $1)`, [config.maxStoredScans]);
}

export async function runStorageMaintenance(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [scanAdmissionLock]);
    // A day-old unfinished job must not retain an image indefinitely or restart forever.
    await client.query(`UPDATE scans SET state = 'INCONCLUSIVE', image_bytes = NULL,
      analysis = NULL, threat_intel = NULL, incomplete = '["extraction","analysis","threat_intel"]'::jsonb,
      error = 'This scan expired before completion. Submit it again.', updated_at = now()
      WHERE state IN ('QUEUED','EXTRACTING','ANALYZING') AND updated_at < now() - interval '1 day'`);
    await pruneScans(client);
    await client.query('DELETE FROM sessions WHERE expires_at <= now()');
    await client.query("DELETE FROM auth_attempts WHERE window_start < now() - interval '1 day'");
    await client.query("DELETE FROM admin_audit WHERE created_at < now() - $1 * interval '1 day'", [config.auditRetentionDays]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

let lastCleanup = 0;
let cleanup: Promise<void> | undefined;
// Request-driven, at most hourly: no timer, cron service, or idle database wakeups.
export async function maintainStorage(): Promise<void> {
  if (Date.now() - lastCleanup < 60 * 60 * 1000) return;
  cleanup ??= runStorageMaintenance().then(() => { lastCleanup = Date.now(); }).finally(() => { cleanup = undefined; });
  await cleanup;
}

// Caller holds scanAdmissionLock inside the same transaction as insert/retry.
export async function reserveScanStorage(client: PoolClient, userId: string, imageBytes: number, newRow: boolean): Promise<void> {
  const { rows: [usage] } = await client.query<{ bytes: string }>(
    'SELECT coalesce(sum(octet_length(image_bytes)), 0)::text AS bytes FROM scans');
  if (Number(usage.bytes) + imageBytes > config.maxPendingImageMb * 1024 * 1024) {
    throw new HttpError(429, 'Screenshot storage busy', 'Wait for screenshot scans to finish, then try again.');
  }
  if (!newRow) return;
  // Prune only finished records; running jobs are never evicted to make room.
  await client.query(`DELETE FROM scans WHERE id IN (
    SELECT id FROM scans WHERE user_id = $1 AND ${terminal} ORDER BY created_at, id
    LIMIT greatest(0, (SELECT count(*) FROM scans WHERE user_id = $1) + 1 - $2))`, [userId, config.maxScansPerUser]);
  await client.query(`DELETE FROM scans WHERE id IN (
    SELECT id FROM scans WHERE ${terminal} ORDER BY created_at, id
    LIMIT greatest(0, (SELECT count(*) FROM scans) + 1 - $1))`, [config.maxStoredScans]);
  const { rows: [counts] } = await client.query<{ total: number; owned: number }>(
    'SELECT count(*)::int AS total, count(*) FILTER (WHERE user_id = $1)::int AS owned FROM scans', [userId]);
  if (counts.total >= config.maxStoredScans || counts.owned >= config.maxScansPerUser) {
    throw new HttpError(429, 'Scan storage busy', 'Wait for current scans to finish, then try again.');
  }
}

import type { PoolClient } from "pg";
import { config } from "../config.js";
import { pool } from "./pool.js";

export interface RuntimeSettings {
  scansPer15Min: number;
  maxScansPerUser: number;
  scanRetentionDays: number;
  maxUploadMb: number;
  maintenance: boolean;
  announcement: string;
}

const KEYS = ["scans_per_15min", "max_scans_per_user", "scan_retention_days", "max_upload_mb", "maintenance", "announcement"] as const;

const asInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// Reads admin-set overrides; anything not stored falls back to the env config.
export async function runtimeSettings(client?: PoolClient): Promise<RuntimeSettings> {
  const { rows } = await (client ?? pool).query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key = ANY($1)", [[...KEYS]]);
  const stored = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    scansPer15Min: asInt(stored.scans_per_15min, 20),
    maxScansPerUser: asInt(stored.max_scans_per_user, config.maxScansPerUser),
    scanRetentionDays: asInt(stored.scan_retention_days, config.scanRetentionDays),
    maxUploadMb: asInt(stored.max_upload_mb, 8),
    maintenance: stored.maintenance === "true",
    announcement: typeof stored.announcement === "string" ? stored.announcement : "",
  };
}

export async function saveSettings(entries: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(entries)) {
    if (!KEYS.includes(key as (typeof KEYS)[number])) continue;
    await pool.query(
      "INSERT INTO settings(key, value, updated_at) VALUES($1, $2, now()) ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = now()",
      [key, value],
    );
  }
}

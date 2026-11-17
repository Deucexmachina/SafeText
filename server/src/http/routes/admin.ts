import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { config } from '../../config.js';
import { runtimeSettings, saveSettings } from '../../db/settings.js';
import { normalizeDomain } from '../../domain/domainLists.js';
import { requireAdmin, verifyPassword } from '../auth.js';
import { HttpError } from '../problem.js';
import { clientAddress } from '../clientIp.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get('/network', (req, res) => res.json({
  ...clientAddress(req), configuredSource: config.clientIpSource,
}));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const limit = Number(query.limit ?? 50);
  const offset = Number(query.offset ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new HttpError(400, 'Invalid pagination', 'Use a limit from 1 to 100 and a non-negative integer offset.');
  }
  return { limit: Math.floor(limit), offset: Math.floor(offset) };
}

// Escaped for a literal ILIKE match so % and _ in the search text stay literal.
const likeEscape = (value: string) => value.replace(/[\\%_]/g, ch => `\\${ch}`);

adminRouter.get('/users', async (req, res, next) => {
  try {
    const { limit, offset } = pagination(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 254) : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    if (status && !['active', 'disabled'].includes(status)) throw new HttpError(400, 'Invalid filter', 'Status must be active or disabled.');
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) throw new HttpError(400, 'Invalid filter', 'Dates must use YYYY-MM-DD.');

    const where: string[] = [];
    const params: unknown[] = [];
    if (search) { params.push(`%${likeEscape(search)}%`); where.push(`u.email ILIKE $${params.length} ESCAPE '\\'`); }
    if (status) { params.push(status === 'disabled'); where.push(`u.disabled = $${params.length}`); }
    if (from) { params.push(from); where.push(`u.created_at >= $${params.length}::date`); }
    if (to) { params.push(to); where.push(`u.created_at < $${params.length}::date + interval '1 day'`); }
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.disabled, u.disabled_reason AS "disabledReason",
         u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt", u.last_active_at AS "lastActiveAt",
         u.failed_logins AS "failedLogins", u.scan_rate_hits AS "scanRateHits",
         u.auth_rate_hits AS "authRateHits", u.reset_rate_hits AS "resetRateHits", u.api_rate_hits AS "apiRateHits",
         LEAST(2147483647, u.scan_rate_hits::bigint + u.auth_rate_hits + u.reset_rate_hits + u.api_rate_hits)::int AS "rateLimitHits",
         (SELECT count(*)::int FROM scans s WHERE s.user_id = u.id) AS "scanCount"
       FROM users u ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY u.created_at, u.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ users: rows });
  } catch (err) { next(err); }
});

// Sensitive admin actions ask for the administrator's own password again, so a
// stolen or unattended session cannot disable accounts on its own.
async function confirmAdminPassword(adminId: string, password: unknown): Promise<void> {
  if (typeof password !== 'string' || !password) {
    throw new HttpError(400, 'Invalid request', 'Re-enter your password to confirm.');
  }
  const { rows } = await pool.query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1', [adminId]);
  if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) {
    throw new HttpError(403, 'Confirmation failed', 'The password you entered is incorrect.');
  }
}

adminRouter.patch('/users/:id', async (req, res, next) => {
  try {
    const allowed = new Set(['disabled', 'reason', 'password']);
    if (!req.is('application/json') || typeof req.body?.disabled !== 'boolean' ||
        Object.keys(req.body).some(key => !allowed.has(key))) {
      throw new HttpError(400, 'Invalid request', 'Send disabled, an optional reason, and your password.');
    }
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length > 200) throw new HttpError(400, 'Invalid request', 'Keep the reason under 200 characters.');
    if (req.body.disabled && !reason) throw new HttpError(400, 'Reason required', 'Give a reason so the user understands why the account was disabled.');
    if (!UUID_RE.test(req.params.id)) throw new HttpError(404, 'Account not found', 'The account does not exist.');
    await confirmAdminPassword(req.user!.id, req.body.password);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Row lock serializes access changes with other admin changes.
      const { rows } = await client.query('SELECT role, disabled FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Account not found', 'The account does not exist.');
      if (rows[0].role === 'admin') throw new HttpError(403, 'Access denied', 'The administrator cannot be disabled here.');
      await client.query('UPDATE users SET disabled = $2, disabled_reason = $3 WHERE id = $1',
        [req.params.id, req.body.disabled, req.body.disabled ? reason : null]);
      // Re-enabling never restores revoked sessions.
      await client.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
      await client.query('INSERT INTO admin_audit(actor_id, target_id, action, reason) VALUES($1, $2, $3, $4)',
        [req.user!.id, req.params.id, req.body.disabled ? 'disable_user' : 'enable_user', reason || null]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// Ends every session for an account without disabling it.
adminRouter.post('/users/:id/force-logout', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) throw new HttpError(404, 'Account not found', 'The account does not exist.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT role FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Account not found', 'The account does not exist.');
      if (rows[0].role === 'admin') throw new HttpError(403, 'Access denied', 'The administrator cannot be logged out here.');
      await client.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
      await client.query('INSERT INTO admin_audit(actor_id, target_id, action) VALUES($1, $2, $3)',
        [req.user!.id, req.params.id, 'force_logout']);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

interface AuditRow {
  id: number; actorEmail: string; targetEmail: string;
  action: string; reason: string | null; createdAt: Date;
}

async function auditRows(limit: number, offset: number): Promise<AuditRow[]> {
  const { rows } = await pool.query<AuditRow>(
    `SELECT aa.id, actor.email AS "actorEmail", target.email AS "targetEmail",
       aa.action, aa.reason, aa.created_at AS "createdAt"
     FROM admin_audit aa
     JOIN users actor ON actor.id = aa.actor_id
     JOIN users target ON target.id = aa.target_id
     ORDER BY aa.created_at DESC, aa.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  return rows;
}

// Aggregate dashboard numbers only — no message content ever leaves the API.
adminRouter.get('/overview', async (_req, res, next) => {
  try {
    const { rows: [totals] } = await pool.query<{ totalUsers: number; scansToday: number; failedToday: number }>(
      `SELECT (SELECT count(*)::int FROM users) AS "totalUsers",
              (SELECT count(*)::int FROM scans WHERE created_at >= date_trunc('day', now())) AS "scansToday",
              (SELECT count(*)::int FROM scans WHERE created_at >= date_trunc('day', now())
                AND state IN ('PARTIAL','INCONCLUSIVE')) AS "failedToday"`);
    const { rows: verdictRows } = await pool.query<{ verdict: string; count: number }>(
      `SELECT analysis->>'verdict' AS verdict, count(*)::int AS count FROM scans
       WHERE created_at >= date_trunc('day', now()) AND analysis IS NOT NULL GROUP BY 1`);
    const { rows: domains } = await pool.query<{ domain: string; hits: number }>(
      `SELECT lower(split_part(regexp_replace(u->>'url', '^[a-z][a-z0-9+.-]*://', '', 'i'), '/', 1)) AS domain,
              count(*)::int AS hits
       FROM scans s, jsonb_array_elements(s.threat_intel->'urls') u
       WHERE jsonb_typeof(s.threat_intel->'urls') = 'array' AND u->>'threat' IS NOT NULL
       GROUP BY 1 ORDER BY hits DESC, domain LIMIT 10`);
    const { rows: stageRows } = await pool.query<{ stage: string; failures: number }>(
      `SELECT st.value AS stage, count(*)::int AS failures
       FROM scans s, jsonb_array_elements_text(s.incomplete) st(value)
       WHERE s.created_at >= date_trunc('day', now()) GROUP BY st.value`);

    const verdictsToday = { safe: 0, suspicious: 0, malicious: 0, inconclusive: 0 };
    for (const row of verdictRows) {
      const key = row.verdict?.toLowerCase() as keyof typeof verdictsToday;
      if (key in verdictsToday) verdictsToday[key] = row.count;
    }
    const stageFailures = Object.fromEntries(stageRows.map(r => [r.stage, r.failures]));
    const { rows: trends } = await pool.query<{ category: string; count: number }>(
      `SELECT scam_category AS category, count(*)::int AS count FROM scans
       WHERE created_at >= now() - interval '7 days' AND scam_category IS NOT NULL
         AND analysis->>'verdict' IN ('MALICIOUS','SUSPICIOUS')
       GROUP BY 1 ORDER BY count DESC, 1`);
    res.json({
      totalUsers: totals.totalUsers,
      scansToday: totals.scansToday,
      verdictsToday,
      scamTrends7d: trends,
      topFlaggedDomains: domains,
      health: {
        failedToday: totals.failedToday,
        providers: [
          { id: 'llm_whisperer', label: 'LLM Whisperer (OCR)', mode: config.llmWhispererApiKey ? 'live' : 'stub', failuresToday: stageFailures['extraction'] ?? 0 },
          { id: 'kimi', label: 'Kimi (analysis)', mode: config.kimiApiKey ? 'live' : 'stub', failuresToday: stageFailures['analysis'] ?? 0 },
          { id: 'safe_browsing', label: 'Google Safe Browsing (links)', mode: config.safeBrowsingApiKey ? 'live' : 'stub', failuresToday: stageFailures['threat_intel'] ?? 0 },
        ],
      },
    });
  } catch (err) { next(err); }
});

adminRouter.get('/audit', async (req, res, next) => {
  try {
    if (req.query.format === 'csv') {
      const rows = await auditRows(5000, 0);
      const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
      const lines = ['time,actor,target,action,reason',
        ...rows.map(r => [r.createdAt.toISOString(), r.actorEmail, r.targetEmail, r.action, r.reason ?? ''].map(csvCell).join(','))];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="safetext-audit.csv"');
      // BOM lets Excel open the UTF-8 CSV with correct encoding.
      res.send(String.fromCharCode(0xfeff) + `${lines.join('\r\n')}\r\n`);
      return;
    }
    const { limit, offset } = pagination(req.query);
    res.json({ audit: await auditRows(limit, offset) });
  } catch (err) { next(err); }
});

// Admin-curated domain lists; applyDomainLists enforces them at scan time.
adminRouter.get("/domains", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT domain, list, created_at FROM domain_lists ORDER BY list, domain");
    res.json({ rows });
  } catch (err) { next(err); }
});

adminRouter.post("/domains", async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    const list = req.body?.list;
    if (list !== "block" && list !== "allow") throw new HttpError(400, "Invalid request", "list must be block or allow.");
    const domain = normalizeDomain(String(req.body?.domain ?? ""));
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new HttpError(400, "Invalid request", "Enter a domain like gcash.com.");
    const { rows: [row] } = await pool.query(
      `INSERT INTO domain_lists(domain, list, added_by) VALUES($1, $2, $3)
       ON CONFLICT(domain) DO UPDATE SET list = $2, added_by = $3 RETURNING domain, list, created_at`,
      [domain, list, req.user!.id]);
    res.json(row);
  } catch (err) { next(err); }
});

adminRouter.delete("/domains/:domain", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM domain_lists WHERE domain = $1", [req.params.domain]);
    if (!rowCount) throw new HttpError(404, "Domain not found", "It is not on any list.");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Verdict reports; shared_text is null unless the reporting user consented.
adminRouter.get("/reports", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.scan_id AS "scanId", r.created_at AS "createdAt", u.email, r.expected_verdict AS expected,
              s.analysis->>'verdict' AS reported, r.shared_text IS NOT NULL AS shared, r.shared_text AS text
       FROM scan_reports r JOIN scans s ON s.id = r.scan_id JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC LIMIT 200`);
    const { rows: [summary] } = await pool.query<{ false_alarms: number; missed_scams: number }>(
      `SELECT count(*) FILTER (WHERE r.expected_verdict = 'SAFE' AND s.analysis->>'verdict' IN ('MALICIOUS','SUSPICIOUS'))::int AS false_alarms,
              count(*) FILTER (WHERE r.expected_verdict IN ('MALICIOUS','SUSPICIOUS') AND s.analysis->>'verdict' = 'SAFE')::int AS missed_scams
       FROM scan_reports r JOIN scans s ON s.id = r.scan_id`);
    res.json({ rows, falseAlarms: summary.false_alarms, missedScams: summary.missed_scams });
  } catch (err) { next(err); }
});

adminRouter.get("/settings", async (_req, res, next) => {
  try { res.json(await runtimeSettings()); } catch (err) { next(err); }
});

adminRouter.put("/settings", async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    const b = req.body ?? {};
    const entries: Record<string, string> = {};
    const ints: [string, number, number, string][] = [
      ["scansPer15Min", 1, 200, "scans_per_15min"],
      ["maxScansPerUser", 1, 1000, "max_scans_per_user"],
      ["scanRetentionDays", 1, 3650, "scan_retention_days"],
      ["maxUploadMb", 1, 16, "max_upload_mb"],
    ];
    for (const [field, min, max, key] of ints) {
      if (b[field] === undefined) continue;
      const value = Number(b[field]);
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new HttpError(400, "Invalid request", `${field} must be a whole number between ${min} and ${max}.`);
      }
      entries[key] = String(value);
    }
    if (b.maintenance !== undefined) entries.maintenance = b.maintenance === true ? "true" : "false";
    if (b.announcement !== undefined) {
      if (typeof b.announcement !== "string" || b.announcement.length > 500) {
        throw new HttpError(400, "Invalid request", "announcement must be text up to 500 characters.");
      }
      entries.announcement = b.announcement;
    }
    await saveSettings(entries);
    res.json(await runtimeSettings());
  } catch (err) { next(err); }
});

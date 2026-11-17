import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { config } from '../../config.js';
import { runtimeSettings, saveSettings, type RuntimeSettings } from '../../db/settings.js';
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

/* Every admin change is written to admin_audit, inside the same transaction as
   the change itself, so nothing changes without a record. targetId names an
   affected account (if any); details says what changed (domains, settings). */
async function recordAudit(db: Pick<PoolClient, 'query'>, actorId: string, action: string,
  entry: { targetId?: string | null; reason?: string | null; details?: string | null } = {}): Promise<void> {
  await db.query('INSERT INTO admin_audit(actor_id, target_id, action, reason, details) VALUES($1, $2, $3, $4, $5)',
    [actorId, entry.targetId ?? null, action, entry.reason ?? null, entry.details ?? null]);
}

const LIST_LABELS: Record<string, string> = { block: 'Blocklist', allow: 'Allowlist' };
const REASON_MAX = 500;
const AUDIT_PAGE_SIZE = 15;
const OPERATOR = 'Server operator (command line)';
const sessionsEnded = (count: number) => `${count} ${count === 1 ? 'session' : 'sessions'} ended`;

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
    if (reason.length > REASON_MAX) throw new HttpError(400, 'Invalid request', `Keep the reason to ${REASON_MAX} characters or fewer.`);
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
      const { rowCount: ended } = await client.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
      await recordAudit(client, req.user!.id, req.body.disabled ? 'disable_user' : 'enable_user',
        { targetId: req.params.id, reason: reason || null, details: req.body.disabled ? sessionsEnded(ended ?? 0) : null });
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
    const rawReason: unknown = req.body?.reason;
    if (rawReason !== undefined && typeof rawReason !== 'string') throw new HttpError(400, 'Invalid request', 'The reason must be text.');
    const reason = (rawReason ?? '').trim();
    if (reason.length > REASON_MAX) throw new HttpError(400, 'Invalid request', `Keep the reason to ${REASON_MAX} characters or fewer.`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT role FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Account not found', 'The account does not exist.');
      if (rows[0].role === 'admin') throw new HttpError(403, 'Access denied', 'The administrator cannot be logged out here.');
      const { rowCount: ended } = await client.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
      await recordAudit(client, req.user!.id, 'force_logout',
        { targetId: req.params.id, reason: reason || null, details: sessionsEnded(ended ?? 0) });
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

interface AuditRow {
  id: number; actorEmail: string | null; targetEmail: string | null;
  action: string; reason: string | null; details: string | null; createdAt: Date;
}

// Audit entries hold only admin metadata (emails, domains, setting values, reasons).
// Message text, scan history, passwords, codes, tokens and keys are never stored here.
async function auditRows(limit: number, offset: number): Promise<AuditRow[]> {
  const { rows } = await pool.query<AuditRow>(
    `SELECT aa.id, actor.email AS "actorEmail", target.email AS "targetEmail",
       aa.action, aa.reason, aa.details, aa.created_at AS "createdAt"
     FROM admin_audit aa
     LEFT JOIN users actor ON actor.id = aa.actor_id
     LEFT JOIN users target ON target.id = aa.target_id
     ORDER BY aa.created_at DESC, aa.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  return rows;
}

const auditTotal = async () => (await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM admin_audit')).rows[0].total;

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
      // Exporting the log is itself recorded (it hands account emails to a file).
      await recordAudit(pool, req.user!.id, 'export_audit', { details: `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}` });
      // Cells starting with =, +, - or @ would run as formulas in Excel, so they get a leading '.
      const csvCell = (value: unknown) => {
        const text = String(value ?? '');
        return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
      };
      const lines = ['time,actor,target,action,reason,details',
        ...rows.map(r => [r.createdAt.toISOString(), r.actorEmail ?? OPERATOR, r.targetEmail ?? '', r.action, r.reason ?? '', r.details ?? ''].map(csvCell).join(','))];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="safetext-audit.csv"');
      // BOM lets Excel open the UTF-8 CSV with correct encoding.
      res.send(String.fromCharCode(0xfeff) + `${lines.join('\r\n')}\r\n`);
      return;
    }
    let limit: number, offset: number, page: number | undefined;
    if (req.query.page !== undefined || req.query.pageSize !== undefined) {
      page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? AUDIT_PAGE_SIZE);
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw new HttpError(400, 'Invalid pagination', 'Use a page of 1 or more and a pageSize from 1 to 100.');
      }
      limit = pageSize; offset = (page - 1) * pageSize;
    } else ({ limit, offset } = pagination(req.query));
    const [rows, total] = await Promise.all([auditRows(limit, offset), auditTotal()]);
    res.json({
      audit: rows.map(row => ({ ...row, actorEmail: row.actorEmail, view: describeAudit(row) })),
      total, page: page ?? Math.floor(offset / limit) + 1, pageSize: limit,
    });
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [previous] } = await client.query<{ list: string }>(
        'SELECT list FROM domain_lists WHERE domain = $1 FOR UPDATE', [domain]);
      const { rows: [row] } = await client.query(
        `INSERT INTO domain_lists(domain, list, added_by) VALUES($1, $2, $3)
         ON CONFLICT(domain) DO UPDATE SET list = $2, added_by = $3 RETURNING domain, list, created_at`,
        [domain, list, req.user!.id]);
      // Re-adding a domain to the list it is already on changes nothing, so it is not logged.
      if (!previous) await recordAudit(client, req.user!.id, 'add_domain', { details: `${domain} → ${LIST_LABELS[list]}` });
      else if (previous.list !== list) {
        await recordAudit(client, req.user!.id, 'move_domain', { details: `${domain}: ${LIST_LABELS[previous.list]} → ${LIST_LABELS[list]}` });
      }
      await client.query('COMMIT');
      res.json(row);
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

adminRouter.delete("/domains/:domain", async (req, res, next) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [removed] } = await client.query<{ list: string }>(
        "DELETE FROM domain_lists WHERE domain = $1 RETURNING list", [req.params.domain]);
      if (!removed) throw new HttpError(404, "Domain not found", "It is not on any list.");
      await recordAudit(client, req.user!.id, 'remove_domain', { details: `${req.params.domain} (was on the ${LIST_LABELS[removed.list]})` });
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await runtimeSettings(client);
      await saveSettings(entries, client);
      const after = await runtimeSettings(client);
      // Record only what actually changed, as "Label: before → after".
      const changes = settingChanges(before, after);
      if (changes.length) await recordAudit(client, req.user!.id, 'update_settings', { details: changes.join('; ') });
      await client.query('COMMIT');
      res.json(after);
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

const SETTING_LABELS: Record<keyof RuntimeSettings, string> = {
  scansPer15Min: 'Scans per 15 minutes',
  maxScansPerUser: 'Scans kept per account',
  scanRetentionDays: 'Retention (days)',
  maxUploadMb: 'Max upload (MB)',
  maintenance: 'Maintenance mode',
  announcement: 'Announcement',
};

function settingChanges(before: RuntimeSettings, after: RuntimeSettings): string[] {
  const show = (key: keyof RuntimeSettings, value: RuntimeSettings[keyof RuntimeSettings]) => {
    if (key === 'maintenance') return value ? 'on' : 'off';
    if (key === 'announcement') {
      const text = String(value);
      return text ? `"${text}"` : '(none)';
    }
    return String(value);
  };
  return (Object.keys(SETTING_LABELS) as (keyof RuntimeSettings)[])
    .filter(key => before[key] !== after[key])
    .map(key => `${SETTING_LABELS[key]}: ${show(key, before[key])} → ${show(key, after[key])}`);
}

/* ------------------------------------------------------------------ */
/* Friendly, per-action view of an audit entry for the details panel. */
/* Built only from the audit row itself (no scans, messages or secrets). */
/* ------------------------------------------------------------------ */

export interface AuditView {
  fields: { label: string; value: string; mono?: boolean }[];
  changes: { label: string; before: string; after: string }[];
  note: string | null;
}

const LIST_OUTCOME: Record<string, string> = {
  Blocklist: 'Links to this domain (and its subdomains) are now always flagged.',
  Allowlist: 'Links to this domain (and its subdomains) are now never flagged.',
};
const NO_DETAILS = 'No additional details were recorded for this action.';
const SETTING_LABEL_PATTERN = Object.values(SETTING_LABELS).map(l => l.replace(/[()]/g, '\\$&')).join('|');
const unquote = (value: string) => (value === '(none)' ? 'None' : value.replace(/^"([\s\S]*)"$/, '$1'));

export function describeAudit(row: Pick<AuditRow, 'action' | 'targetEmail' | 'details'>): AuditView {
  const view: AuditView = { fields: [], changes: [], note: null };
  const details = row.details ?? '';
  const account = () => view.fields.push({ label: 'Account', value: row.targetEmail ?? 'Account no longer exists' });
  const sessions = () => {
    const match = /^(\d+) sessions? ended$/.exec(details);
    if (match) view.fields.push({ label: 'Sessions ended', value: match[1] });
    return !!match;
  };
  let match: RegExpExecArray | null;
  switch (row.action) {
    case 'disable_user':
      account(); view.changes.push({ label: 'Status', before: 'Active', after: 'Disabled' }); sessions();
      break;
    case 'enable_user':
      account(); view.changes.push({ label: 'Status', before: 'Disabled', after: 'Active' });
      break;
    case 'force_logout':
      account();
      if (!sessions()) view.note = 'The number of sessions ended was not recorded for this entry.';
      break;
    case 'grant_admin':
      account(); view.changes.push({ label: 'Role', before: 'User', after: 'Admin' });
      view.note = 'Granted from the server command line, not from the admin console.';
      break;
    case 'add_domain':
      if ((match = /^(.+) → (Blocklist|Allowlist)$/.exec(details))) {
        view.fields.push({ label: 'Domain', value: match[1], mono: true }, { label: 'Added to', value: match[2] });
        view.note = LIST_OUTCOME[match[2]];
      }
      break;
    case 'move_domain':
      if ((match = /^(.+): (Blocklist|Allowlist) → (Blocklist|Allowlist)$/.exec(details))) {
        view.fields.push({ label: 'Domain', value: match[1], mono: true });
        view.changes.push({ label: 'List', before: match[2], after: match[3] });
        view.note = LIST_OUTCOME[match[3]];
      }
      break;
    case 'remove_domain':
      if ((match = /^(.+) \(was on the (Blocklist|Allowlist)\)$/.exec(details))) {
        view.fields.push({ label: 'Domain', value: match[1], mono: true }, { label: 'Removed from', value: match[2] });
        view.note = 'This domain is no longer on any list.';
      }
      break;
    case 'update_settings':
      // Stored as "Label: before → after" joined by "; " (split only before a known label).
      for (const part of details.split(new RegExp(`; (?=(?:${SETTING_LABEL_PATTERN}): )`))) {
        const change = /^([^:]+): ((?:\(none\)|"[\s\S]*?"|[^→]*?)) → ([\s\S]*)$/.exec(part);
        if (change) view.changes.push({ label: change[1], before: unquote(change[2].trim()), after: unquote(change[3].trim()) });
      }
      break;
    case 'export_audit':
      if ((match = /^(\d+) entr(?:y|ies)$/.exec(details))) {
        view.fields.push({ label: 'Entries exported', value: match[1] }, { label: 'Format', value: 'CSV file' });
      }
      break;
  }
  // Anything recorded but not understood above is still shown as plain text.
  if (!view.fields.length && !view.changes.length && details) view.fields.push({ label: 'Details', value: details });
  if (!view.fields.length && !view.changes.length && !view.note) view.note = NO_DETAILS;
  return view;
}

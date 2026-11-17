import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router, type Request, type RequestHandler } from "express";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { HttpError } from "./problem.js";
import { emailSender } from "../providers/index.js";
import { sleep } from "../lib/sleep.js";
import type { PoolClient } from 'pg';
import { EmailDeliveryError } from '../providers/email/BrevoEmailSender.js';
import { authLimiter, resetRequestLimiter, resetVerifyLimiter, resetPasswordLimiter } from './rateLimits.js';

const derive = promisify(scrypt);
const cookieName = "safetext_session";
const lifetime = 7 * 24 * 60 * 60 * 1000;
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: config.secureCookies, path: "/" };
export interface User { id: string; email: string; role: 'user' | 'admin' }
declare global {
  namespace Express { interface Request { user?: User } }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [salt, hash] = encoded.split(":");
  if (!salt || !hash) return false;
  const key = await derive(password, salt, 64) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
function tokenHash(req: Request): string {
  const token = req.headers.cookie?.split(";").map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? "";
  return createHash("sha256").update(token).digest("hex");
}
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const { rows } = await pool.query<User>(
      `SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled`, [tokenHash(req)],
    );
    if (!rows[0]) throw new HttpError(401, "Login required", "Please log in to continue.");
    req.user = rows[0];
    // Throttled write keeps one UPDATE per 15 minutes per account.
    pool.query(
      "UPDATE users SET last_active_at = now() WHERE id = $1 AND (last_active_at IS NULL OR last_active_at < now() - interval '15 minutes')",
      [rows[0].id],
    ).catch(() => {});
    next();
  } catch (err) { next(err); }
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'admin') return next(new HttpError(403, "Access denied", "Administrator access is required."));
  next();
};

// SameSite cookies plus an explicit browser origin check protect cookie-authenticated writes.
export const checkOrigin: RequestHandler = (req, _res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      ((req.headers.origin && req.headers.origin !== config.appOrigin) || req.headers["sec-fetch-site"] === "cross-site")) {
    return next(new HttpError(403, "Invalid origin", "This request came from an untrusted site."));
  }
  next();
};

export const authRouter = Router();
authRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
for (const action of ["register", "login"] as const) {
  authRouter.post(`/${action}`, authLimiter, async (req, res, next) => {
    try {
      if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send credentials as application/json.");
      if (req.body?.role !== undefined || req.body?.disabled !== undefined) throw new HttpError(400, "Invalid request", "Account permissions cannot be set during registration or login.");
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const password: unknown = req.body?.password;
      if (!EMAIL_RE.test(email) || email.length > 254 ||
          typeof password !== "string" || password.length < 12 || password.length > 128) {
        throw new HttpError(400, "Invalid credentials", "Enter a valid email and a password of 12 to 128 characters.");
      }
      let user: User;
      let authenticatedHash: string;
      if (action === "register") {
        const hash = await hashPassword(password);
        authenticatedHash = hash;
        const client = await pool.connect();
        try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(1935763002)');
        const { rows: [capacity] } = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM users');
        if (capacity.count >= config.maxAccounts) throw new HttpError(503, 'Registration full', 'This project has reached its account limit. Contact the administrator.');
        const { rows } = await client.query<User>(
          "INSERT INTO users(id, email, password_hash) VALUES($1, $2, $3) ON CONFLICT(email) DO NOTHING RETURNING id, email, role",
          [randomUUID(), email, hash],
        );
        if (!rows[0]) throw new HttpError(409, "Account unavailable", "An account with that email already exists. Please log in.");
        user = rows[0];
        await client.query('COMMIT');
        } catch (err) { await client.query('ROLLBACK'); throw err; }
        finally { client.release(); }
      } else {
        const { rows } = await pool.query<User & { password_hash: string; disabled: boolean; disabled_reason: string | null }>(
          "SELECT id, email, role, disabled, disabled_reason, password_hash FROM users WHERE email = $1", [email]);
        // Perform the expensive derivation even for unknown accounts.
        const valid = await verifyPassword(password, rows[0]?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`);
        if (!rows[0] || !valid) {
          if (rows[0]) await pool.query("UPDATE users SET failed_logins = failed_logins + 1 WHERE id = $1", [rows[0].id]);
          throw new HttpError(401, "Login failed", "Email or password is incorrect.");
        }
        if (rows[0].disabled) {
          const reason = rows[0].disabled_reason ? ` Reason given: ${rows[0].disabled_reason}` : "";
          throw new HttpError(403, "Account disabled", `Your account is disabled.${reason} Please contact the administrator for assistance.`);
        }
        user = { id: rows[0].id, email: rows[0].email, role: rows[0].role };
        authenticatedHash = rows[0].password_hash;
        await pool.query("UPDATE users SET failed_logins = 0, last_login_at = now() WHERE id = $1", [user.id]);
      }
      const token = randomBytes(32).toString("hex");
      const client = await pool.connect();
      try {
      await client.query('BEGIN');
      // Serialize session issuance for this account and retain at most five devices.
      const { rows: [current] } = await client.query<{ password_hash: string; disabled: boolean }>(
        'SELECT password_hash, disabled FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      // A reset/disable may have completed while password verification was running.
      if (!current || current.disabled || current.password_hash !== authenticatedHash) {
        throw new HttpError(401, 'Login failed', 'Your account changed while logging in. Please log in again.');
      }
      await client.query("DELETE FROM sessions WHERE token_hash = $1 OR expires_at <= now()", [tokenHash(req)]);
      await client.query(`DELETE FROM sessions WHERE token_hash IN (
        SELECT token_hash FROM sessions WHERE user_id = $1 ORDER BY expires_at DESC, token_hash DESC OFFSET 4)`, [user.id]);
      await client.query("INSERT INTO sessions(token_hash, user_id, expires_at, user_agent) VALUES($1, $2, $3, $4)",
        [createHash("sha256").update(token).digest("hex"), user.id, new Date(Date.now() + lifetime), req.get("user-agent")?.slice(0, 300) ?? null]);
      await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; }
      finally { client.release(); }
      res.cookie(cookieName, token, { ...cookieOptions, maxAge: lifetime });
      res.status(action === "register" ? 201 : 200).json({ user });
    } catch (err) { next(err); }
  });
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = config.resetMaxCodeAttempts;

function resetCodeHash(userId: string, code: string): string {
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

// Shared check for /verify-reset-code and /reset-password. Wrong guesses burn
// attempts and a code dies after MAX_CODE_ATTEMPTS. Callers turn every failure
// into the same generic error so nothing about the account is revealed.
async function validateResetCode(
  client: PoolClient,
  email: string,
  code: string,
): Promise<{ ok: boolean; userId?: string }> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1 AND NOT disabled FOR UPDATE",
    [email],
  );
  const user = rows[0];
  if (!user) return { ok: false };
  const { rows: [row] } = await client.query<{
    code_hash: string; expires_at: Date; used_at: Date | null; attempts: number;
  }>(
    "SELECT code_hash, expires_at, used_at, attempts FROM password_resets WHERE user_id = $1 FOR UPDATE",
    [user.id],
  );
  if (!row || row.used_at || row.expires_at.getTime() <= Date.now() || row.attempts >= MAX_CODE_ATTEMPTS) {
    return { ok: false };
  }
  const expected = Buffer.from(resetCodeHash(user.id, code));
  const actual = Buffer.from(row.code_hash);
  if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
    return { ok: true, userId: user.id };
  }
  const attempts = row.attempts + 1;
  await client.query(
    `UPDATE password_resets SET attempts = $2::int,
       used_at = CASE WHEN $2::int >= $3::int THEN now() ELSE used_at END
     WHERE user_id = $1`,
    [user.id, attempts, MAX_CODE_ATTEMPTS],
  );
  return { ok: false };
}

// Always answers the same way: the response never reveals whether the address
// is registered or whether an email was actually sent.
authRouter.post("/forgot-password", resetRequestLimiter, async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email) || email.length > 254) {
      throw new HttpError(400, "Invalid request", "Enter a valid email address.");
    }
    // Configuration is global: the same 503 for every address reveals no account information.
    if (!emailSender.configured) throw new HttpError(503, 'Password reset unavailable', 'Password reset email is temporarily unavailable. Contact the site administrator.');
    let delivery: { userId: string; code: string; hash: string } | undefined;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [user] } = await client.query<{ id: string; disabled: boolean }>(
        'SELECT id, disabled FROM users WHERE email = $1 FOR UPDATE', [email]);
      if (user && !user.disabled) {
          const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
          const hash = resetCodeHash(user.id, code);
          await client.query(
          `INSERT INTO password_resets(user_id, code_hash, expires_at) VALUES($1, $2, $3)
           ON CONFLICT(user_id) DO UPDATE
             SET code_hash = $2, expires_at = $3, used_at = NULL, attempts = 0, created_at = now()`,
            [user.id, hash, new Date(Date.now() + CODE_TTL_MS)]);
          delivery = { userId: user.id, code, hash };
      }
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
    if (delivery) {
      try {
        await emailSender.sendPasswordResetCode({ to: email, code: delivery.code, expiresMinutes: 5 });
      } catch (err) {
        // A failed send must not leave an undelivered code valid or block a retry.
        // The hash condition protects any newer request from being deleted.
        await pool.query('DELETE FROM password_resets WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL', [delivery.userId, delivery.hash]);
        console.warn('Password reset email delivery failed', { status: err instanceof EmailDeliveryError ? err.status : undefined });
      }
    } else {
      // Blunt the timing difference between known and unknown addresses.
      await sleep(150 + Math.random() * 150);
    }
    res.json({ ok: true, resendAfter: config.resetResendCooldownSeconds });
  } catch (err) { next(err); }
});

authRouter.post("/verify-reset-code", resetVerifyLimiter, async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
      throw new HttpError(400, "Invalid or expired code", "Enter the 6-digit code sent to the email.");
    }
    const client = await pool.connect();
    let ok = false;
    try {
      await client.query('BEGIN');
      ({ ok } = await validateResetCode(client, email, code));
      await client.query('COMMIT'); // Persist failed-guess counters too.
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
    if (!ok) throw new HttpError(400, "Invalid or expired code", "The code is invalid or has expired. Request a new one.");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

authRouter.post("/reset-password", resetPasswordLimiter, async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const password: unknown = req.body?.password;
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code) ||
        typeof password !== "string" || password.length < 12 || password.length > 128) {
      throw new HttpError(400, "Invalid request", "Enter the 6-digit code and a password of 12 to 128 characters.");
    }
    // Derive the password before acquiring locks; revalidate the code after hashing.
    const hash = await hashPassword(password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { ok, userId } = await validateResetCode(client, email, code);
      if (!ok || !userId) {
        await client.query('COMMIT'); // Do not roll back failed-guess counters.
        return next(new HttpError(400, 'Invalid or expired code', 'The code is invalid or has expired. Request a new one.'));
      }
      // Consumes the code atomically; a concurrent reset finds it already spent.
      const { rows: consumed } = await client.query(
        `UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND code_hash = $2
         AND used_at IS NULL AND expires_at > clock_timestamp() AND attempts < $3 RETURNING user_id`,
        [userId, resetCodeHash(userId, code), MAX_CODE_ATTEMPTS]);
      if (!consumed[0]) throw new HttpError(400, "Invalid or expired code", "The code is invalid or has expired. Request a new one.");
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, hash]);
      // Sessions minted under the old password are all ended.
      await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

authRouter.get("/me", requireAuth, (req, res) => { res.json({ user: req.user }); });
authRouter.post("/logout", async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(req)]);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Rough browser/OS label for the signed-in devices list; raw agents are not exposed.
function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /Windows NT/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux" : "another OS";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Version\/[\d.]+.*Safari\//.test(ua) ? "Safari" : "a browser";
  return `${browser} on ${os}`;
}

authRouter.get("/sessions", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query<{ token_hash: string; created_at: Date; user_agent: string | null }>(
      "SELECT token_hash, created_at, user_agent FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY created_at DESC, token_hash",
      [req.user!.id]);
    const current = tokenHash(req);
    res.json({ sessions: rows.map(r => ({
      id: r.token_hash.slice(0, 12),
      device: describeAgent(r.user_agent),
      signedInAt: r.created_at?.toISOString() ?? null,
      current: r.token_hash === current,
    })) });
  } catch (err) { next(err); }
});

authRouter.delete("/sessions/:id", requireAuth, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM sessions WHERE user_id = $1 AND starts_with(token_hash, $2)", [req.user!.id, req.params.id]);
    if (!rowCount) throw new HttpError(404, "Session not found", "That device is no longer signed in.");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

authRouter.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    const { currentPassword, password } = req.body ?? {};
    if (typeof currentPassword !== "string" || !currentPassword ||
        typeof password !== "string" || password.length < 12 || password.length > 128) {
      throw new HttpError(400, "Invalid request", "Enter your current password and a new password of 12 to 128 characters.");
    }
    const { rows: [row] } = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1", [req.user!.id]);
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      throw new HttpError(401, "Wrong password", "Your current password is incorrect.");
    }
    await pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [req.user!.id, await hashPassword(password)]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

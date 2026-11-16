import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router, type Request, type RequestHandler } from "express";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { HttpError } from "./problem.js";
import { emailSender } from "../providers/index.js";
import { sleep } from "../lib/sleep.js";

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
// Database-backed limits survive restarts and apply across API processes.
const limiter: RequestHandler = async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    for (const value of [`ip:${req.ip}`, `account:${email}`]) {
      const key = createHash('sha256').update(value).digest('hex');
      const { rows } = await pool.query<{ attempts: number }>(
        `INSERT INTO auth_attempts(key_hash, attempts, window_start) VALUES($1, 1, now())
         ON CONFLICT(key_hash) DO UPDATE SET
           attempts = CASE WHEN auth_attempts.window_start < now() - interval '15 minutes' THEN 1 ELSE LEAST(auth_attempts.attempts + 1, 21) END,
           window_start = CASE WHEN auth_attempts.window_start < now() - interval '15 minutes' THEN now() ELSE auth_attempts.window_start END
         RETURNING attempts`, [key]);
      if (rows[0].attempts > 20) {
        res.setHeader('Retry-After', '900');
        throw new HttpError(429, 'Too many attempts', 'Try again in 15 minutes.');
      }
    }
    await pool.query("DELETE FROM auth_attempts WHERE window_start < now() - interval '1 day'");
    next();
  } catch (err) { next(err); }
};

for (const action of ["register", "login"] as const) {
  authRouter.post(`/${action}`, limiter, async (req, res, next) => {
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
      if (action === "register") {
        const hash = await hashPassword(password);
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
        await pool.query("UPDATE users SET failed_logins = 0, last_login_at = now() WHERE id = $1", [user.id]);
      }
      const token = randomBytes(32).toString("hex");
      const client = await pool.connect();
      try {
      await client.query('BEGIN');
      // Serialize session issuance for this account and retain at most five devices.
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      await client.query("DELETE FROM sessions WHERE token_hash = $1 OR expires_at <= now()", [tokenHash(req)]);
      await client.query(`DELETE FROM sessions WHERE token_hash IN (
        SELECT token_hash FROM sessions WHERE user_id = $1 ORDER BY expires_at DESC, token_hash DESC OFFSET 4)`, [user.id]);
      await client.query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES($1, $2, $3)",
        [createHash("sha256").update(token).digest("hex"), user.id, new Date(Date.now() + lifetime)]);
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
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 8;
const MAX_RESETS_PER_DAY = 3;

function resetCodeHash(userId: string, code: string): string {
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

// Shared check for /verify-reset-code and /reset-password. Wrong guesses burn
// attempts and a code dies after MAX_CODE_ATTEMPTS. Callers turn every failure
// into the same generic error so nothing about the account is revealed.
async function validateResetCode(
  email: string,
  code: string,
): Promise<{ ok: boolean; userId?: string }> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1 AND NOT disabled",
    [email],
  );
  const user = rows[0];
  if (!user) return { ok: false };
  const { rows: [row] } = await pool.query<{
    code_hash: string; expires_at: Date; used_at: Date | null; attempts: number;
  }>(
    "SELECT code_hash, expires_at, used_at, attempts FROM password_resets WHERE user_id = $1",
    [user.id],
  );
  if (!row || row.used_at || row.expires_at.getTime() <= Date.now() || row.attempts >= MAX_CODE_ATTEMPTS) {
    return { ok: false };
  }
  if (timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(resetCodeHash(user.id, code)))) {
    return { ok: true, userId: user.id };
  }
  const attempts = row.attempts + 1;
  await pool.query(
    `UPDATE password_resets SET attempts = $2::int,
       used_at = CASE WHEN $2::int >= $3::int THEN now() ELSE used_at END
     WHERE user_id = $1`,
    [user.id, attempts, MAX_CODE_ATTEMPTS],
  );
  return { ok: false };
}

// Always answers the same way: the response never reveals whether the address
// is registered or whether an email was actually sent.
authRouter.post("/forgot-password", limiter, async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email) || email.length > 254) {
      throw new HttpError(400, "Invalid request", "Enter a valid email address.");
    }
    const { rows } = await pool.query<{ id: string; disabled: boolean }>(
      "SELECT id, disabled FROM users WHERE email = $1", [email]);
    const user = rows[0];
    if (user && !user.disabled) {
      const { rows: [existing] } = await pool.query<{ created_at: Date }>(
        "SELECT created_at FROM password_resets WHERE user_id = $1", [user.id]);
      const coolingDown = !!existing && Date.now() - existing.created_at.getTime() < RESEND_COOLDOWN_MS;
      if (!coolingDown) {
        const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
        await pool.query(
          `INSERT INTO password_resets(user_id, code_hash, expires_at) VALUES($1, $2, $3)
           ON CONFLICT(user_id) DO UPDATE
             SET code_hash = $2, expires_at = $3, used_at = NULL, attempts = 0, created_at = now()`,
          [user.id, resetCodeHash(user.id, code), new Date(Date.now() + CODE_TTL_MS)]);
        try {
          await emailSender.sendPasswordResetCode({ to: email, code, expiresMinutes: 5 });
        } catch (err) {
          console.warn("password reset email not delivered:", err instanceof Error ? err.message : err);
        }
      }
    } else {
      // Blunt the timing difference between known and unknown addresses.
      await sleep(150 + Math.random() * 150);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

authRouter.post("/verify-reset-code", limiter, async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
      throw new HttpError(400, "Invalid or expired code", "Enter the 6-digit code sent to the email.");
    }
    const { ok } = await validateResetCode(email, code);
    if (!ok) throw new HttpError(400, "Invalid or expired code", "The code is invalid or has expired. Request a new one.");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

authRouter.post("/reset-password", limiter, async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const password: unknown = req.body?.password;
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code) ||
        typeof password !== "string" || password.length < 12 || password.length > 128) {
      throw new HttpError(400, "Invalid request", "Enter the 6-digit code and a password of 12 to 128 characters.");
    }
    const { ok, userId } = await validateResetCode(email, code);
    if (!ok || !userId) throw new HttpError(400, "Invalid or expired code", "The code is invalid or has expired. Request a new one.");
    const hash = await hashPassword(password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Consumes the code atomically; a concurrent reset finds it already spent.
      const { rows: consumed } = await client.query(
        "UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL RETURNING user_id",
        [userId]);
      if (!consumed[0]) throw new HttpError(400, "Invalid or expired code", "The code is invalid or has expired. Request a new one.");
      // Row lock keeps the per-day cap atomic across concurrent resets.
      const { rows: [account] } = await client.query<{ resets: number; next_at: Date | null }>(
        `SELECT password_reset_count AS resets,
                CASE WHEN password_reset_window > now() - interval '1 day'
                     THEN password_reset_window + interval '1 day' END AS next_at
           FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      if (account && account.resets >= MAX_RESETS_PER_DAY && account.next_at) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((account.next_at.getTime() - Date.now()) / 1000))));
        throw new HttpError(429, 'Too many resets', 'Passwords can be reset at most 3 times per day. Try again later.');
      }
      await client.query(
        `UPDATE users SET password_hash = $2,
           password_reset_count = CASE WHEN password_reset_window IS NULL OR password_reset_window < now() - interval '1 day'
                THEN 1 ELSE password_reset_count + 1 END,
           password_reset_window = CASE WHEN password_reset_window IS NULL OR password_reset_window < now() - interval '1 day'
                THEN now() ELSE password_reset_window END
         WHERE id = $1`, [userId, hash]);
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

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router, type Request, type RequestHandler } from "express";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { HttpError } from "./problem.js";

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
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
          typeof password !== "string" || password.length < 12 || password.length > 128) {
        throw new HttpError(400, "Invalid credentials", "Enter a valid email and a password of 12 to 128 characters.");
      }
      let user: User;
      if (action === "register") {
        const hash = await hashPassword(password);
        const { rows } = await pool.query<User>(
          "INSERT INTO users(id, email, password_hash) VALUES($1, $2, $3) ON CONFLICT(email) DO NOTHING RETURNING id, email, role",
          [randomUUID(), email, hash],
        );
        if (!rows[0]) throw new HttpError(409, "Account unavailable", "An account with that email already exists. Please log in.");
        user = rows[0];
      } else {
        const { rows } = await pool.query<User & { password_hash: string; disabled: boolean }>("SELECT id, email, role, disabled, password_hash FROM users WHERE email = $1", [email]);
        // Perform the expensive derivation even for unknown accounts.
        const valid = await verifyPassword(password, rows[0]?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`);
        if (!rows[0] || !valid || rows[0].disabled) throw new HttpError(401, "Login failed", "Email or password is incorrect or the account is unavailable.");
        user = { id: rows[0].id, email: rows[0].email, role: rows[0].role };
      }
      const token = randomBytes(32).toString("hex");
      await pool.query("DELETE FROM sessions WHERE token_hash = $1 OR expires_at <= now()", [tokenHash(req)]);
      await pool.query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES($1, $2, $3)",
        [createHash("sha256").update(token).digest("hex"), user.id, new Date(Date.now() + lifetime)]);
      res.cookie(cookieName, token, { ...cookieOptions, maxAge: lifetime });
      res.status(action === "register" ? 201 : 200).json({ user });
    } catch (err) { next(err); }
  });
}
authRouter.get("/me", requireAuth, (req, res) => { res.json({ user: req.user }); });
authRouter.post("/logout", async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(req)]);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

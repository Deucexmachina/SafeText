import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router, type Request, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { HttpError } from "./problem.js";

const derive = promisify(scrypt);
const cookieName = "safetext_session";
const lifetime = 7 * 24 * 60 * 60 * 1000;
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: config.secureCookies, path: "/" };
export interface User { id: string; email: string }
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
      `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(req)],
    );
    if (!rows[0]) throw new HttpError(401, "Login required", "Please log in to continue.");
    req.user = rows[0];
    next();
  } catch (err) { next(err); }
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
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, "Too many attempts", "Try again in 15 minutes.")),
});

for (const action of ["register", "login"] as const) {
  authRouter.post(`/${action}`, limiter, async (req, res, next) => {
    try {
      if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send credentials as application/json.");
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
          "INSERT INTO users(id, email, password_hash) VALUES($1, $2, $3) ON CONFLICT(email) DO NOTHING RETURNING id, email",
          [randomUUID(), email, hash],
        );
        if (!rows[0]) throw new HttpError(409, "Account unavailable", "An account with that email already exists. Please log in.");
        user = rows[0];
      } else {
        const { rows } = await pool.query<User & { password_hash: string }>("SELECT id, email, password_hash FROM users WHERE email = $1", [email]);
        // Perform the expensive derivation even for unknown accounts.
        const valid = await verifyPassword(password, rows[0]?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`);
        if (!rows[0] || !valid) throw new HttpError(401, "Login failed", "Email or password is incorrect.");
        user = { id: rows[0].id, email: rows[0].email };
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

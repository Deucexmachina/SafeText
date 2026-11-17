import { createHash } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { runtimeSettings } from '../db/settings.js';
import { clientRateKey } from './clientIp.js';
import { HttpError, sendProblem } from './problem.js';

type Category = 'auth' | 'reset' | 'scan' | 'api';
type Identity = 'ip' | 'email' | 'user';
interface Bucket { scope: string; identity: Identity; limit: number; seconds: number }
export const normalizedEmail = (req: Request): string => typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
const validEmail = (value: string): boolean => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const rateLimitKey = (scope: string, identity: string): string => createHash('sha256').update(`${scope}:${identity}`).digest('hex');

/** Fixed windows begin at the first request. The atomic upsert survives restarts and concurrent instances. */
export async function consumeLimit(scope: string, identity: string, limit: number, seconds: number) {
  const { rows: [row] } = await pool.query<{ attempts: number; retry_after: number }>(
    `INSERT INTO auth_attempts AS counter(key_hash, attempts, window_start) VALUES($1, 1, statement_timestamp())
     ON CONFLICT(key_hash) DO UPDATE SET
       attempts = CASE WHEN counter.window_start <= statement_timestamp() - $3::int * interval '1 second'
         THEN 1 ELSE LEAST(counter.attempts, $2::int) + 1 END,
       window_start = CASE WHEN counter.window_start <= statement_timestamp() - $3::int * interval '1 second'
         THEN statement_timestamp() ELSE counter.window_start END
     RETURNING attempts, greatest(1, ceil(extract(epoch FROM
       window_start + $3::int * interval '1 second' - statement_timestamp())))::int AS retry_after`,
    [rateLimitKey(scope, identity), limit, seconds]);
  return { allowed: row.attempts <= limit, remaining: Math.max(0, limit - row.attempts), retryAfter: row.retry_after };
}

/** Counts blocks, not allowed requests. Email-targeted blocks are not proof the owner caused them. */
export async function recordRateHit(req: Request, category: Category, byEmail = false): Promise<void> {
  const column = { auth: 'auth_rate_hits', reset: 'reset_rate_hits', scan: 'scan_rate_hits', api: 'api_rate_hits' }[category];
  try {
    const increment = `UPDATE users SET ${column} = LEAST(${column}, 2147483646) + 1`;
    if (req.user) { await pool.query(`${increment} WHERE id = $1`, [req.user.id]); return; }
    if (byEmail) {
      const email = normalizedEmail(req);
      if (validEmail(email)) await pool.query(`${increment} WHERE email = $1`, [email]);
      return;
    }
    const token = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('safetext_session='))?.slice('safetext_session='.length);
    if (token && /^[a-f0-9]{64}$/i.test(token)) {
      await pool.query(`${increment} WHERE id IN (SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now())`,
        [createHash('sha256').update(token).digest('hex')]);
    }
  } catch { console.warn('Could not update a rate-limit hit counter.'); }
}

function headers(res: Response, limit: number, seconds: number, remaining: number, reset: number): void {
  res.setHeader('RateLimit', `limit=${limit}, remaining=${remaining}, reset=${reset}`);
  res.setHeader('RateLimit-Policy', `${limit};w=${seconds}`);
}

function limiter(category: Category, buckets: (req: Request) => Bucket[] | Promise<Bucket[]>, title: string): RequestHandler {
  return async (req, res, next) => {
    try {
      for (const bucket of await buckets(req)) {
        const identity = bucket.identity === 'ip' ? clientRateKey(req) : bucket.identity === 'user' ? req.user?.id : normalizedEmail(req);
        if (!identity || (bucket.identity === 'email' && !validEmail(identity))) continue;
        const result = await consumeLimit(bucket.scope, identity, bucket.limit, bucket.seconds);
        headers(res, bucket.limit, bucket.seconds, result.remaining, result.retryAfter);
        if (!result.allowed) {
          await recordRateHit(req, category, bucket.identity === 'email');
          res.setHeader('Retry-After', String(result.retryAfter));
          return sendProblem(res, 429, title, `Too many requests. Try again in ${result.retryAfter} seconds.`);
        }
      }
      next();
    } catch {
      // A failed database check must never silently disable protection.
      next(new HttpError(503, 'Request limits unavailable', 'Request limits could not be checked. Please try again shortly.'));
    }
  };
}

export const apiLimiter = limiter('api', () => [{ scope: 'api-ip', identity: 'ip', limit: config.apiRateLimitPerMinute, seconds: 60 }], 'Request limit reached');
export const authLimiter = limiter('auth', () => [
  { scope: 'auth-ip', identity: 'ip', limit: config.authRateLimitPerIp, seconds: 900 },
  { scope: 'auth-email', identity: 'email', limit: config.authRateLimitPerEmail, seconds: 900 },
], 'Too many login or registration attempts');
export const resetRequestLimiter = limiter('reset', () => [
  { scope: 'reset-send-ip', identity: 'ip', limit: config.resetRequestsPerHourPerIp, seconds: 3600 },
  { scope: 'reset-send-email', identity: 'email', limit: config.resetRequestsPerHourPerEmail, seconds: 3600 },
  // Every request that reaches the email bucket counts, including rapid resends.
  { scope: 'reset-cooldown', identity: 'email', limit: 1, seconds: config.resetResendCooldownSeconds },
], 'Reset email request limit reached');
export const resetVerifyLimiter = limiter('reset', () => [
  { scope: 'reset-verify-ip', identity: 'ip', limit: config.resetVerifyPer15MinPerIp, seconds: 900 },
  { scope: 'reset-verify-email', identity: 'email', limit: config.resetVerifyPer15MinPerEmail, seconds: 900 },
], 'Reset verification limit reached');
export const resetPasswordLimiter = limiter('reset', () => [
  // Retain the broad IP guard, with a separate per-email policy for setting a password.
  { scope: 'reset-verify-ip', identity: 'ip', limit: config.resetVerifyPer15MinPerIp, seconds: 900 },
  { scope: 'reset-password-email', identity: 'email', limit: config.resetPasswordAttemptsPerMinute, seconds: 60 },
], 'Password reset attempt limit reached');
export const scanLimiter = limiter('scan', async () => [{ scope: 'scan-user', identity: 'user',
  limit: (await runtimeSettings()).scansPer15Min, seconds: 900 }], 'Scan limit reached');

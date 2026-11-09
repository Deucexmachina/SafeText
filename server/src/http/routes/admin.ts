import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../problem.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/users', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, 'Invalid pagination', 'Use a limit from 1 to 100 and a non-negative integer offset.');
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.disabled, u.created_at AS "createdAt",
         (SELECT count(*)::int FROM scans s WHERE s.user_id = u.id) AS "scanCount"
       FROM users u ORDER BY u.created_at, u.id LIMIT $1 OFFSET $2`, [Math.floor(limit), offset]);
    res.json({ users: rows });
  } catch (err) { next(err); }
});

adminRouter.patch('/users/:id', async (req, res, next) => {
  try {
    if (!req.is('application/json') || typeof req.body?.disabled !== 'boolean' ||
        Object.keys(req.body).some(key => key !== 'disabled')) throw new HttpError(400, 'Invalid request', 'Send only a boolean disabled field.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) throw new HttpError(404, 'Account not found', 'The account does not exist.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Row lock serializes access changes with other admin changes.
      const { rows } = await client.query('SELECT role, disabled FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Account not found', 'The account does not exist.');
      if (rows[0].role === 'admin') throw new HttpError(403, 'Access denied', 'The administrator cannot be disabled here.');
      await client.query('UPDATE users SET disabled = $2 WHERE id = $1', [req.params.id, req.body.disabled]);
      // Re-enabling never restores revoked sessions.
      await client.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
      await client.query('INSERT INTO admin_audit(actor_id, target_id, action) VALUES($1, $2, $3)', [req.user!.id, req.params.id, req.body.disabled ? 'disable_user' : 'enable_user']);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

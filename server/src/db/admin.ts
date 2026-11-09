import { pool } from './pool.js';
import { migrate } from './migrate.js';

// Local operator command only; public registration can never grant roles.
const email = process.argv[2]?.trim().toLowerCase();
try {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: npm --prefix server run admin:grant -- existing-account@example.com');
  await migrate();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('UPDATE users SET role = \'admin\', disabled = false WHERE email = $1 RETURNING id', [email]);
    if (!rows[0]) throw new Error('Account not found. Register the intended admin account first.');
    await client.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
    await client.query('COMMIT');
    console.log('Admin access granted. Log in again to use the Admin tab.');
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505') throw new Error('An administrator already exists. No account permissions were changed.');
    throw err;
  } finally { client.release(); }
} catch (err) {
  console.error(err instanceof Error ? err.message : 'Admin setup failed.');
  process.exitCode = 1;
} finally { await pool.end(); }

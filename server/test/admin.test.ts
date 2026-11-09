import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { Pool } from 'pg';

test('RBAC and security boundaries against PostgreSQL', async t => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://safetext:safetext@localhost:5432/safetext');
  const admin = new Pool({ connectionString: url.href });
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options', `-c search_path=${schema}`); process.env.DATABASE_URL = url.href;
  const { pool } = await import('../src/db/pool.js');
  const { migrate } = await import('../src/db/migrate.js');
  const { createApp } = await import('../src/app.js');
  await migrate(); await migrate();
  const server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const password = 'a long secure test password';
  const call = (path: string, method = 'GET', body?: unknown, cookie = '', origin?: string) => fetch(`${base}${path}`, {
    method, headers: { Cookie: cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  async function register(email: string) {
    const res = await call('/auth/register', 'POST', { email, password }); assert.equal(res.status, 201);
    const data = await res.json() as { user: { id: string; role: string } };
    assert.equal(data.user.role, 'user');
    return { id: data.user.id, cookie: res.headers.get('set-cookie')!.split(';')[0] };
  }
  try {
    const operator = await register('operator@example.com');
    const regular = await register('regular@example.com');
    await t.test('no first-user admin, self-promotion, or public admin access', async () => {
      assert.equal((await call('/admin/users')).status, 401);
      assert.equal((await call('/admin/users', 'GET', undefined, regular.cookie)).status, 403);
      assert.equal((await call('/auth/register', 'POST', { email: 'attacker@example.com', password, role: 'admin' })).status, 400);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: true }, regular.cookie)).status, 403);
    });
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [operator.id]);
    await t.test('only one administrator is allowed and roles are checked per request', async () => {
      await assert.rejects(() => pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [regular.id]), (err: unknown) => (err as { code?: string }).code === '23505');
      const res = await call('/admin/users', 'GET', undefined, operator.cookie); assert.equal(res.status, 200);
      const data = await res.json() as { users: Record<string, unknown>[] };
      assert.equal(data.users.length, 2);
      assert(data.users.every(user => !('password_hash' in user) && !('scans' in user)));
      assert.equal((await call('/admin/users?offset=Infinity', 'GET', undefined, operator.cookie)).status, 400);
      await pool.query("UPDATE users SET role = 'user' WHERE id = $1", [operator.id]);
      assert.equal((await call('/admin/users', 'GET', undefined, operator.cookie)).status, 403);
      await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [operator.id]);
    });
    await t.test('admin cannot read or delete another account scan', async () => {
      await pool.query("INSERT INTO scans(id, user_id, input_type, input_text, state) VALUES('private', $1, 'text', 'private SMS', 'COMPLETE')", [regular.id]);
      assert.equal((await call('/scan/private', 'GET', undefined, operator.cookie)).status, 404);
      assert.equal((await call('/scan/private', 'DELETE', undefined, operator.cookie)).status, 404);
    });
    await t.test('disable revokes sessions; enable requires new login; changes are audited', async () => {
      assert.equal((await call(`/admin/users/${operator.id}`, 'PATCH', { disabled: true }, operator.cookie)).status, 403);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: true }, operator.cookie, 'https://evil.example')).status, 403);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { role: 'admin', disabled: false }, operator.cookie)).status, 400);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: true }, operator.cookie)).status, 200);
      assert.equal((await call('/auth/me', 'GET', undefined, regular.cookie)).status, 401);
      assert.equal((await call('/auth/login', 'POST', { email: 'regular@example.com', password })).status, 401);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: false }, operator.cookie)).status, 200);
      assert.equal((await call('/auth/me', 'GET', undefined, regular.cookie)).status, 401);
      assert.equal((await call('/auth/login', 'POST', { email: 'regular@example.com', password })).status, 200);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM admin_audit')).rows[0].count, 2);
    });
    await t.test('API sends security headers and rejects oversized JSON without details', async () => {
      const health = await call('/health');
      assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(health.headers.get('x-frame-options'), 'DENY');
      assert.equal(health.headers.get('cache-control'), 'no-store');
      const res = await call('/auth/login', 'POST', { email: 'regular@example.com', password: 'x'.repeat(70_000) });
      assert.equal(res.status, 413); assert.doesNotMatch(await res.text(), /stack|node_modules/);
    });
    await t.test('queue admission enforces per-account capacity under concurrent submissions', async () => {
      const { createScan } = await import('../src/db/scans.js');
      const attempts = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => createScan({ id: `capacity_${i}`, userId: regular.id, inputType: 'text', inputText: 'test' })));
      assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 3);
      const rejected = attempts.find(result => result.status === 'rejected');
      assert(rejected?.status === 'rejected'); assert.equal(rejected.reason.status, 429);
      await pool.query("DELETE FROM scans WHERE id LIKE 'capacity_%'");
    });
    await t.test('login throttling enforces pre-existing database state', async () => {
      const key = createHash('sha256').update('account:limited@example.com').digest('hex');
      await pool.query('INSERT INTO auth_attempts(key_hash, attempts, window_start) VALUES($1,20,now())', [key]);
      const res = await call('/auth/login', 'POST', { email: 'limited@example.com', password });
      assert.equal(res.status, 429); assert.equal(res.headers.get('retry-after'), '900');
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});

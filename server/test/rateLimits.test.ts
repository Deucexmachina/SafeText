import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Request } from 'express';
import { test } from 'node:test';
import { Pool } from 'pg';

test('persistent rate limits, Render identity, retry metadata and admin hit counts', async t => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://safetext:safetext@localhost:5432/safetext');
  const admin = new Pool({ connectionString: url.href });
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options', `-c search_path=${schema}`); process.env.DATABASE_URL = url.href;
  process.env.CLIENT_IP_SOURCE = 'socket';
  process.env.BREVO_API_KEY = ''; process.env.SMTP_URL = ''; process.env.EMAIL_DEV_LOG = '1';
  process.env.KIMI_API_KEY = ''; process.env.LLM_WHISPERER_API_KEY = ''; process.env.GOOGLE_SAFE_BROWSING_API_KEY = '';
  const { pool } = await import('../src/db/pool.js');
  const { migrate } = await import('../src/db/migrate.js');
  const { config } = await import('../src/config.js');
  const { createApp } = await import('../src/app.js');
  const { consumeLimit, rateLimitKey } = await import('../src/http/rateLimits.js');
  const { clientRateKey } = await import('../src/http/clientIp.js');
  const { emailSender } = await import('../src/providers/index.js');
  const originalConfig = { ...config };
  const originalSend = emailSender.sendPasswordResetCode;
  const delivered: { to: string; code: string }[] = [];
  emailSender.sendPasswordResetCode = async input => { delivered.push(input); };
  await migrate();
  const first = createApp().listen(0, '127.0.0.1'); await once(first, 'listening');
  const second = createApp().listen(0, '127.0.0.1'); await once(second, 'listening');
  const address1 = first.address(), address2 = second.address();
  assert(address1 && typeof address1 !== 'string' && address2 && typeof address2 !== 'string');
  const base = `http://127.0.0.1:${address1.port}/api/v1`;
  const otherBase = `http://127.0.0.1:${address2.port}/api/v1`;
  const password = 'a long rate test password';
  const email = 'limits@example.com';
  async function call(path: string, options: { body?: unknown; cookie?: string; ip?: string; xff?: string; other?: boolean } = {}) {
    return fetch(`${options.other ? otherBase : base}${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.ip ? { 'CF-Connecting-IP': options.ip } : {}),
        ...(options.xff ? { 'X-Forwarded-For': options.xff } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }
  async function resetLimits() {
    Object.assign(config, originalConfig);
    config.apiRateLimitPerMinute = 1000;
    await pool.query('DELETE FROM auth_attempts');
    await pool.query('DELETE FROM settings');
    await pool.query('UPDATE users SET scan_rate_hits = 0, auth_rate_hits = 0, reset_rate_hits = 0, api_rate_hits = 0');
    delivered.length = 0;
  }
  async function expire(scope: string, identity: string, seconds = 901) {
    await pool.query("UPDATE auth_attempts SET window_start = now() - $2::int * interval '1 second' WHERE key_hash = $1", [rateLimitKey(scope, identity), seconds]);
  }
  try {
    const registration = await call('/auth/register', { body: { email, password } }); assert.equal(registration.status, 201);
    const user = (await registration.json() as { user: { id: string } }).user;
    let cookie = registration.headers.get('set-cookie')!.split(';')[0];
    const other = await call('/auth/register', { body: { email: 'other@example.com', password } }); assert.equal(other.status, 201);
    const otherUser = (await other.json() as { user: { id: string } }).user;
    const otherCookie = other.headers.get('set-cookie')!.split(';')[0];
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);

    await t.test('only explicit Render mode trusts a valid Cloudflare IP; arbitrary forwarded headers cannot choose a local identity', async () => {
      await resetLimits();
      const local = await (await call('/admin/network', { cookie, ip: '203.0.113.5', xff: '198.51.100.9' })).json();
      assert.equal(local.source, 'socket'); assert.notEqual(local.ip, '203.0.113.5');
      config.clientIpSource = 'render'; // Simulate the platform's trusted edge in this local test only.
      const edge = await (await call('/admin/network', { cookie, ip: '203.0.113.5', xff: '198.51.100.9' })).json();
      assert.equal(edge.source, 'render'); assert.equal(edge.ip, '203.0.113.5');
      const malformed = await (await call('/admin/network', { cookie, ip: '203.0.113.5, 198.51.100.9' })).json();
      assert.equal(malformed.source, 'socket');
      assert.equal((await call('/admin/network')).status, 401);
      assert.equal((await call('/admin/network', { cookie: otherCookie })).status, 403);
      const request = (ip: string) => ({ get: () => ip, socket: { remoteAddress: '127.0.0.1' } }) as unknown as Request;
      assert.equal(clientRateKey(request('2001:db8:1234:5600::1')), clientRateKey(request('2001:db8:1234:56ff::abcd')));
      assert.notEqual(clientRateKey(request('2001:db8:1234:5600::1')), clientRateKey(request('2001:db8:1234:5700::1')));
      assert.equal(clientRateKey(request('::ffff:192.0.2.4')), clientRateKey(request('192.0.2.4')));
    });

    await t.test('general API limits isolate clients, survive a second app, ignore XFF spoofing and exempt health checks', async () => {
      await resetLimits(); config.clientIpSource = 'render'; config.apiRateLimitPerMinute = 2;
      const options = { ip: '203.0.113.8', cookie };
      assert.equal((await call('/status', options)).status, 200);
      for (let i = 0; i < 4; i++) assert.equal((await call('/health', options)).status, 200);
      assert.equal((await call('/status', options)).status, 200);
      const blocked = await call('/status', { ...options, xff: '192.0.2.1' });
      assert.equal(blocked.status, 429); assert.match(blocked.headers.get('content-type')!, /application\/problem\+json/);
      assert(Number(blocked.headers.get('retry-after')) <= 60); assert(Number(blocked.headers.get('retry-after')) > 0);
      assert.match(blocked.headers.get('ratelimit')!, /remaining=0/);
      assert.equal((await call('/status', { ...options, other: true })).status, 429);
      assert.equal((await call('/status', { ip: '203.0.113.9' })).status, 200);
      assert.equal((await pool.query('SELECT api_rate_hits FROM users WHERE id = $1', [user.id])).rows[0].api_rate_hits, 2);
      assert.equal((await call('/health', { ...options, body: {} })).status, 429, 'only actual health probes are exempt');
    });

    await t.test('reset cooldown is normalized, uniform for unknown accounts, and records target hits without sending twice', async () => {
      await resetLimits();
      const known = await call('/auth/forgot-password', { body: { email } }); assert.equal(known.status, 200);
      const duplicate = await call('/auth/forgot-password', { body: { email: ' LIMITS@EXAMPLE.COM ' } });
      assert.equal(duplicate.status, 429); assert(Number(duplicate.headers.get('retry-after')) <= 60);
      assert.equal((await pool.query('SELECT attempts FROM auth_attempts WHERE key_hash = $1',
        [rateLimitKey('reset-send-email', email)])).rows[0].attempts, 2, 'rapid resends also spend the hourly request quota');
      assert.equal(delivered.length, 1);
      const unknown = await call('/auth/forgot-password', { body: { email: 'unknown@example.com' } });
      assert.equal(unknown.status, 200); assert.deepEqual(await unknown.json(), await known.json());
      assert.equal((await call('/auth/forgot-password', { body: { email: 'unknown@example.com' } })).status, 429);
      assert.equal(delivered.length, 1);
      assert.equal((await pool.query('SELECT reset_rate_hits FROM users WHERE id = $1', [user.id])).rows[0].reset_rate_hits, 1);
    });

    await t.test('hourly reset-email budget persists after cooldown and across app instances', async () => {
      await resetLimits();
      assert.equal(config.resetRequestsPerHourPerEmail, 5);
      for (let i = 0; i < 5; i++) {
        await expire('reset-cooldown', email, 61);
        assert.equal((await call('/auth/forgot-password', { body: { email } })).status, 200);
      }
      await expire('reset-cooldown', email, 61);
      const blocked = await call('/auth/forgot-password', { body: { email }, other: true });
      assert.equal(blocked.status, 429); assert(Number(blocked.headers.get('retry-after')) > 3500);
      assert.equal(delivered.length, 5);
    });

    await t.test('code verification has a separate budget from final password setting and login', async () => {
      await resetLimits(); config.resetVerifyPer15MinPerEmail = 2;
      await call('/auth/forgot-password', { body: { email } });
      const code = delivered.at(-1)!.code;
      const wrong = code === '000000' ? '000001' : '000000';
      assert.equal((await call('/auth/verify-reset-code', { body: { email, code: wrong } })).status, 400);
      assert.equal((await call('/auth/verify-reset-code', { body: { email, code: wrong } })).status, 400);
      assert.equal((await call('/auth/verify-reset-code', { body: { email, code } })).status, 429);
      assert.equal((await call('/auth/reset-password', { body: { email, code, password } })).status, 200);
      const login = await call('/auth/login', { body: { email, password } });
      assert.equal(login.status, 200); cookie = login.headers.get('set-cookie')!.split(';')[0];
      assert.equal((await pool.query('SELECT reset_rate_hits FROM users WHERE id = $1', [user.id])).rows[0].reset_rate_hits, 1);
    });

    await t.test('five final password attempts per minute include invalid submissions and persist across apps', async () => {
      await resetLimits(); assert.equal(config.resetPasswordAttemptsPerMinute, 5);
      const body = { email, code: '123456', password: 'short' };
      for (let i = 0; i < 5; i++) assert.equal((await call('/auth/reset-password', { body })).status, 400);
      const sixth = await call('/auth/reset-password', { body });
      assert.equal(sixth.status, 429); assert(Number(sixth.headers.get('retry-after')) <= 60);
      assert.equal((await call('/auth/reset-password', { body, other: true })).status, 429);
      assert.equal((await pool.query('SELECT reset_rate_hits FROM users WHERE id = $1', [user.id])).rows[0].reset_rate_hits, 2);
      assert.equal((await call('/auth/reset-password', { body: { ...body, email: 'other@example.com' } })).status, 400);
      await expire('reset-password-email', email, 61);
      assert.equal((await call('/auth/reset-password', { body })).status, 400);
    });

    await t.test('scan limits persist across apps and respect admin overrides and account isolation', async () => {
      await resetLimits();
      await pool.query("INSERT INTO settings(key,value) VALUES('scans_per_15min','1')");
      assert.equal((await call('/scan', { cookie, body: { text: 'Hello tomorrow' } })).status, 202);
      const blocked = await call('/scan', { cookie, body: { text: 'Hello again' }, other: true });
      assert.equal(blocked.status, 429); assert(Number(blocked.headers.get('retry-after')) > 0);
      assert.equal((await call('/scan', { cookie: otherCookie, body: { text: 'Hello tomorrow' } })).status, 202);
      const counters = (await pool.query('SELECT scan_rate_hits FROM users WHERE id = $1', [user.id])).rows[0];
      assert.equal(counters.scan_rate_hits, 1);
      const result = await (await call('/admin/users', { cookie })).json() as { users: { id: string; rateLimitHits: number; scanRateHits: number; resetRateHits: number }[] };
      const visible = result.users.find(row => row.id === user.id)!;
      assert.equal(visible.rateLimitHits, 1); assert.equal(visible.scanRateHits, 1); assert.equal(visible.resetRateHits, 0);
    });

    await t.test('email-targeted login blocks count separately; IP blocks do not blame the requested email', async () => {
      await resetLimits(); config.authRateLimitPerEmail = 1;
      assert.equal((await call('/auth/login', { body: { email, password } })).status, 200);
      assert.equal((await call('/auth/login', { body: { email, password } })).status, 429);
      assert.equal((await pool.query('SELECT auth_rate_hits FROM users WHERE id = $1', [user.id])).rows[0].auth_rate_hits, 1);
      await resetLimits(); config.authRateLimitPerIp = 1;
      await call('/auth/login', { body: { email: 'unknown@example.com', password } });
      assert.equal((await call('/auth/login', { cookie: otherCookie, body: { email, password } })).status, 429);
      assert.equal((await pool.query('SELECT auth_rate_hits FROM users WHERE id = $1', [user.id])).rows[0].auth_rate_hits, 0);
      assert.equal((await pool.query('SELECT auth_rate_hits FROM users WHERE id = $1', [otherUser.id])).rows[0].auth_rate_hits, 1);
    });

    await t.test('atomic counters admit exactly the quota, return remaining time, expire, and retain no raw identity', async () => {
      await resetLimits();
      const results = await Promise.all(Array.from({ length: 25 }, () => consumeLimit('concurrency', 'private@example.com', 10, 900)));
      assert.equal(results.filter(result => result.allowed).length, 10);
      const key = rateLimitKey('concurrency', 'private@example.com');
      await pool.query("UPDATE auth_attempts SET window_start = now() - interval '880 seconds' WHERE key_hash = $1", [key]);
      const blocked = await consumeLimit('concurrency', 'private@example.com', 10, 900);
      assert.equal(blocked.allowed, false); assert(blocked.retryAfter <= 20 && blocked.retryAfter > 0);
      await expire('concurrency', 'private@example.com');
      const renewed = await consumeLimit('concurrency', 'private@example.com', 10, 900);
      assert.equal(renewed.allowed, true); assert.equal(renewed.remaining, 9);
      const records = (await pool.query('SELECT * FROM auth_attempts')).rows;
      assert(records.every(record => /^[a-f0-9]{64}$/.test(record.key_hash)));
      assert(!JSON.stringify(records).includes('private@example.com'));
    });

    await t.test('queue-capacity rejection records one scan hit and supplies a retry delay', async () => {
      await resetLimits();
      for (let i = 0; i < 3; i++) await pool.query(
        "INSERT INTO scans(id,user_id,input_type,state) VALUES($1,$2,'text','QUEUED')", [`capacity-rate-${i}`, user.id]);
      try {
        const response = await call('/scan', { cookie, body: { text: 'Hello' } });
        assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60');
        assert.equal((await pool.query('SELECT scan_rate_hits FROM users WHERE id = $1', [user.id])).rows[0].scan_rate_hits, 1);
      } finally { await pool.query("DELETE FROM scans WHERE id LIKE 'capacity-rate-%'"); }
    });

    await t.test('a rate-limit store outage fails closed without breaking health probes or exposing database details', async () => {
      await resetLimits();
      await pool.query('ALTER TABLE auth_attempts RENAME TO unavailable_rate_limit_store');
      try {
        const response = await call('/status'); assert.equal(response.status, 503);
        assert.doesNotMatch(await response.text(), /auth_attempts|SELECT|INSERT|relation|password/);
        assert.equal((await call('/health')).status, 200);
      } finally { await pool.query('ALTER TABLE unavailable_rate_limit_store RENAME TO auth_attempts'); }
    });
  } finally {
    Object.assign(config, originalConfig); emailSender.sendPasswordResetCode = originalSend;
    await Promise.all([new Promise<void>(resolve => first.close(() => resolve())), new Promise<void>(resolve => second.close(() => resolve()))]);
    // Let any mock scan pipeline finish before dropping its isolated schema.
    for (let i = 0; i < 100; i++) {
      if (!(await pool.query("SELECT id FROM scans WHERE state IN ('QUEUED','EXTRACTING','ANALYZING')")).rowCount) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});

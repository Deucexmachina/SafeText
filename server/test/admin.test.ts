import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
    await t.test('operator command upgrades the old single-admin schema and adds a second admin without replacing the first', async () => {
      // Simulate the deployed schema before this migration.
      await pool.query("CREATE UNIQUE INDEX users_single_admin ON users(role) WHERE role = 'admin'");
      const granted = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/admin.ts', 'regular@example.com'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, DATABASE_URL: url.href },
      });
      assert.equal(granted.status, 0, granted.stderr);
      const grant = (await pool.query("SELECT actor_id, target_id, details FROM admin_audit WHERE action = 'grant_admin'")).rows;
      assert.equal(grant.length, 1, 'granting admin from the command line is audited');
      assert.equal(grant[0].actor_id, null); assert.equal(grant[0].target_id, regular.id);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM users WHERE role = 'admin'")).rows[0].count, 2);
      assert.equal((await call('/auth/me', 'GET', undefined, regular.cookie)).status, 401, 'promotion revokes only the promoted account sessions');
      const login = await call('/auth/login', 'POST', { email: 'regular@example.com', password });
      assert.equal(login.status, 200); regular.cookie = login.headers.get('set-cookie')!.split(';')[0];
      assert.equal((await call('/admin/users', 'GET', undefined, regular.cookie)).status, 200);
      const res = await call('/admin/users', 'GET', undefined, operator.cookie); assert.equal(res.status, 200);
      const data = await res.json() as { users: Record<string, unknown>[] };
      assert.equal(data.users.length, 2);
      assert(data.users.every(user => !('password_hash' in user) && !('scans' in user)));
      assert.equal((await call('/admin/users?offset=Infinity', 'GET', undefined, operator.cookie)).status, 400);
      assert.equal((await call(`/admin/users/${operator.id}`, 'PATCH', { disabled: true, reason: 'test', password }, regular.cookie)).status, 403);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: true, reason: 'test', password }, operator.cookie)).status, 403);
      await pool.query("UPDATE users SET role = 'user' WHERE id = $1", [regular.id]);
      assert.equal((await call('/admin/users', 'GET', undefined, regular.cookie)).status, 403);
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
      assert.equal((await call(`/admin/users/${operator.id}`, 'PATCH', { disabled: true, reason: 'test', password }, operator.cookie)).status, 403);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: true }, operator.cookie, 'https://evil.example')).status, 403);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { role: 'admin', disabled: false }, operator.cookie)).status, 400);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: true, reason: 'spamming scans', password }, operator.cookie)).status, 200);
      assert.equal((await call('/auth/me', 'GET', undefined, regular.cookie)).status, 401);
      const disabledLogin = await call('/auth/login', 'POST', { email: 'regular@example.com', password });
      assert.equal(disabledLogin.status, 403);
      assert.match((await disabledLogin.json() as { detail: string }).detail, /Your account is disabled.*spamming scans/);
      assert.equal(disabledLogin.headers.get('set-cookie'), null);
      const wrongPassword = await call('/auth/login', 'POST', { email: 'regular@example.com', password: 'incorrect password 123' });
      assert.equal(wrongPassword.status, 401);
      assert.doesNotMatch((await wrongPassword.json() as { detail: string }).detail, /disabled/);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: false, password }, operator.cookie)).status, 200);
      assert.equal((await call('/auth/me', 'GET', undefined, regular.cookie)).status, 401);
      assert.equal((await call('/auth/login', 'POST', { email: 'regular@example.com', password })).status, 200);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM admin_audit WHERE action <> 'grant_admin'")).rows[0].count, 2);
    });
    await t.test('confirmation password, force logout, filters, activity fields and audit export', async () => {
      // The admin's own password is required before access changes.
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: true, reason: 'spam', password: 'a wrong but long password' }, operator.cookie)).status, 403);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: true, password }, operator.cookie)).status, 400);
      // Force logout ends sessions without disabling the account.
      const relogin = await call('/auth/login', 'POST', { email: 'regular@example.com', password });
      const reCookie = relogin.headers.get('set-cookie')!.split(';')[0];
      assert.equal((await call(`/admin/users/${regular.id}/force-logout`, 'POST', {}, operator.cookie)).status, 200);
      assert.equal((await call('/auth/me', 'GET', undefined, reCookie)).status, 401);
      const listed = await (await call('/admin/users', 'GET', undefined, operator.cookie)).json() as { users: { email: string; lastLoginAt: string | null; failedLogins: number; scanRateHits: number }[] };
      const regularRow = listed.users.find(u => u.email === 'regular@example.com')!;
      assert(regularRow.lastLoginAt !== null && regularRow.failedLogins === 0 && regularRow.scanRateHits === 0);
      // Failed logins accumulate on the account and reset on success.
      assert.equal((await call('/auth/login', 'POST', { email: 'regular@example.com', password: 'a wrong but long password' })).status, 401);
      assert.equal((await pool.query('SELECT failed_logins FROM users WHERE id = $1', [regular.id])).rows[0].failed_logins, 1);
      assert.equal((await call('/auth/login', 'POST', { email: 'regular@example.com', password })).status, 200);
      assert.equal((await pool.query('SELECT failed_logins FROM users WHERE id = $1', [regular.id])).rows[0].failed_logins, 0);
      // Search and status filters narrow the account list.
      const filtered = await (await call('/admin/users?status=active&search=regular', 'GET', undefined, operator.cookie)).json() as { users: { email: string }[] };
      assert.deepEqual(filtered.users.map(u => u.email), ['regular@example.com']);
      assert.equal((await call('/admin/users?status=bogus', 'GET', undefined, operator.cookie)).status, 400);
      // The audit log lists actions with reasons and exports as CSV.
      const audit = (await (await call('/admin/audit', 'GET', undefined, operator.cookie)).json() as { audit: { action: string; reason: string | null }[] }).audit;
      assert(audit.some(a => a.action === 'force_logout'));
      assert(audit.some(a => a.action === 'disable_user' && a.reason === 'spamming scans'));
      const csv = await call('/admin/audit?format=csv', 'GET', undefined, operator.cookie);
      assert.match(csv.headers.get('content-type')!, /text\/csv/);
      assert.match(await csv.text(), /force_logout/);
      assert.equal((await call('/admin/audit', 'GET', undefined, reCookie)).status, 401);
    });
    await t.test('every admin change is audited: domains, settings and audit export', async () => {
      type Entry = { action: string; targetEmail: string | null; details: string | null; actorEmail: string };
      const latest = async () => (await (await call('/admin/audit?limit=1', 'GET', undefined, operator.cookie)).json() as { audit: Entry[] }).audit[0];
      const count = async () => (await pool.query('SELECT count(*)::int AS c FROM admin_audit')).rows[0].c as number;

      // Adding, moving and removing a domain each leave one entry with no target account.
      assert.equal((await call('/admin/domains', 'POST', { domain: 'audit-test.example', list: 'block' }, operator.cookie)).status, 200);
      let entry = await latest();
      assert.equal(entry.action, 'add_domain'); assert.equal(entry.targetEmail, null);
      assert.equal(entry.details, 'audit-test.example → Blocklist'); assert.equal(entry.actorEmail, 'operator@example.com');
      const beforeNoop = await count();
      assert.equal((await call('/admin/domains', 'POST', { domain: 'audit-test.example', list: 'block' }, operator.cookie)).status, 200);
      assert.equal(await count(), beforeNoop, 're-adding to the same list changes nothing and is not logged');
      assert.equal((await call('/admin/domains', 'POST', { domain: 'audit-test.example', list: 'allow' }, operator.cookie)).status, 200);
      entry = await latest();
      assert.equal(entry.action, 'move_domain'); assert.equal(entry.details, 'audit-test.example: Blocklist → Allowlist');
      assert.equal((await call('/admin/domains/audit-test.example', 'DELETE', undefined, operator.cookie)).status, 200);
      entry = await latest();
      assert.equal(entry.action, 'remove_domain'); assert.equal(entry.details, 'audit-test.example (was on the Allowlist)');

      // Settings record only what changed, as before → after.
      const current = await (await call('/admin/settings', 'GET', undefined, operator.cookie)).json() as { scanRetentionDays: number; maintenance: boolean };
      const retention = current.scanRetentionDays === 14 ? 15 : 14;
      assert.equal((await call('/admin/settings', 'PUT', { scanRetentionDays: retention, maintenance: !current.maintenance, announcement: 'Exams week' }, operator.cookie)).status, 200);
      entry = await latest();
      assert.equal(entry.action, 'update_settings'); assert.equal(entry.targetEmail, null);
      assert.match(entry.details!, new RegExp(`Retention \\(days\\): ${current.scanRetentionDays} → ${retention}`));
      assert.match(entry.details!, /Maintenance mode: (on → off|off → on)/);
      assert.match(entry.details!, /Announcement: \(none\) → "Exams week"/);
      const beforeSame = await count();
      assert.equal((await call('/admin/settings', 'PUT', { scanRetentionDays: retention }, operator.cookie)).status, 200);
      assert.equal(await count(), beforeSame, 'saving unchanged settings is not logged');
      // Restore maintenance so later tests can scan.
      await call('/admin/settings', 'PUT', { maintenance: current.maintenance, announcement: '' }, operator.cookie);

      // A failed change leaves no audit entry (the change and its record share a transaction).
      const beforeFail = await count();
      assert.equal((await call('/admin/domains/not-on-any-list.example', 'DELETE', undefined, operator.cookie)).status, 404);
      assert.equal(await count(), beforeFail);

      // Exporting the log is itself recorded, and spreadsheet formulas are neutralised.
      await pool.query(`INSERT INTO admin_audit(actor_id, action, details) VALUES($1, 'test_formula', '=HYPERLINK("x")')`, [operator.id]);
      const csv = await (await call('/admin/audit?format=csv', 'GET', undefined, operator.cookie)).text();
      assert.match(csv, /time,actor,target,action,reason,details/);
      assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
      assert.match(csv, /add_domain/);
      entry = await latest();
      assert.equal(entry.action, 'export_audit'); assert.match(entry.details!, /^\d+ entr(y|ies)$/);
      await pool.query("DELETE FROM admin_audit WHERE action = 'test_formula'");
    });
    await t.test('audit log: 15 per page with totals, friendly details for every action, reasons, admin-only', async () => {
      type View = { fields: { label: string; value: string }[]; changes: { label: string; before: string; after: string }[]; note: string | null };
      type Entry = { id: number; action: string; reason: string | null; actorEmail: string | null; targetEmail: string | null; view: View };
      type Page = { audit: Entry[]; total: number; page: number; pageSize: number };
      const get = (query: string, cookie = operator.cookie) => call(`/admin/audit?${query}`, 'GET', undefined, cookie);
      const all = async () => (await (await get('page=1&pageSize=100')).json() as Page).audit;
      const newest = async (action: string) => (await all()).find(e => e.action === action)!;
      const field = (e: Entry, label: string) => e.view.fields.find(f => f.label === label)?.value;

      // Admin-only: anonymous and non-admin callers are refused.
      assert.equal((await get('page=1', '')).status, 401);
      const fresh = (await call('/auth/login', 'POST', { email: 'regular@example.com', password })).headers.get('set-cookie')!.split(';')[0];
      assert.equal((await get('page=1', fresh)).status, 403);

      // Forced logout: optional reason, and the number of sessions ended is recorded.
      await call('/auth/login', 'POST', { email: 'regular@example.com', password });
      await call('/auth/login', 'POST', { email: 'regular@example.com', password });
      const live = (await pool.query('SELECT count(*)::int AS c FROM sessions WHERE user_id = $1', [regular.id])).rows[0].c as number;
      assert.equal((await call(`/admin/users/${regular.id}/force-logout`, 'POST', { reason: 'Shared lab computer' }, operator.cookie)).status, 200);
      let entry = await newest('force_logout');
      assert.equal(entry.reason, 'Shared lab computer'); assert.equal(entry.targetEmail, 'regular@example.com');
      assert.equal(field(entry, 'Account'), 'regular@example.com'); assert.equal(field(entry, 'Sessions ended'), String(live));
      assert.equal((await call(`/admin/users/${regular.id}/force-logout`, 'POST', { reason: 'x'.repeat(501) }, operator.cookie)).status, 400);
      assert.equal((await call(`/admin/users/${regular.id}/force-logout`, 'POST', { reason: 42 }, operator.cookie)).status, 400);

      // Disable: reason required, up to 500 characters; status change shown.
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: true, reason: 'y'.repeat(501), password }, operator.cookie)).status, 400);
      const longReason = 'Repeated scam submissions. '.repeat(18).slice(0, 500);
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: true, reason: longReason, password }, operator.cookie)).status, 200);
      entry = await newest('disable_user');
      assert.equal(entry.reason, longReason.trim());
      assert.deepEqual(entry.view.changes, [{ label: 'Status', before: 'Active', after: 'Disabled' }]);
      assert.equal(field(entry, 'Sessions ended'), '0');
      // Enable: reason optional.
      assert.equal((await call(`/admin/users/${regular.id}`, 'PATCH', { disabled: false, reason: 'Appeal accepted', password }, operator.cookie)).status, 200);
      entry = await newest('enable_user');
      assert.equal(entry.reason, 'Appeal accepted');
      assert.deepEqual(entry.view.changes, [{ label: 'Status', before: 'Disabled', after: 'Active' }]);

      // Domains, settings and exports (created by the previous test) get friendly fields.
      entry = await newest('add_domain');
      assert.equal(field(entry, 'Domain'), 'audit-test.example'); assert.equal(field(entry, 'Added to'), 'Blocklist');
      assert.match(entry.view.note!, /always flagged/);
      entry = await newest('move_domain');
      assert.deepEqual(entry.view.changes, [{ label: 'List', before: 'Blocklist', after: 'Allowlist' }]);
      entry = await newest('remove_domain');
      assert.equal(field(entry, 'Removed from'), 'Allowlist'); assert.match(entry.view.note!, /no longer on any list/);
      const settingsEntries = (await all()).filter(e => e.action === 'update_settings');
      const announced = settingsEntries.find(e => e.view.changes.some(c => c.label === 'Announcement' && c.after === 'Exams week'))!;
      assert(announced, 'announcement change is shown as before → after text, without quotes');
      assert.equal(announced.view.changes.find(c => c.label === 'Announcement')!.before, 'None');
      assert(announced.view.changes.some(c => c.label === 'Retention (days)' && /^\d+$/.test(c.before) && /^\d+$/.test(c.after)));
      assert(announced.view.changes.some(c => c.label === 'Maintenance mode' && ['on', 'off'].includes(c.after)));
      entry = await newest('export_audit');
      assert.match(field(entry, 'Entries exported')!, /^\d+$/); assert.equal(field(entry, 'Format'), 'CSV file');
      // Role change from the command line: no admin actor.
      entry = await newest('grant_admin');
      assert.equal(entry.actorEmail, null);
      assert.deepEqual(entry.view.changes, [{ label: 'Role', before: 'User', after: 'Admin' }]);
      // Older entries without extra data get a short note instead of an empty panel.
      await pool.query("INSERT INTO admin_audit(actor_id, target_id, action) VALUES($1, $2, 'force_logout')", [operator.id, regular.id]);
      await pool.query("INSERT INTO admin_audit(actor_id, action) VALUES($1, 'legacy_unknown')", [operator.id]);
      const legacy = await all();
      assert.match(legacy.find(e => e.action === 'force_logout' && !field(e, 'Sessions ended'))!.view.note!, /not recorded/);
      assert.equal(legacy.find(e => e.action === 'legacy_unknown')!.view.note, 'No additional details were recorded for this action.');

      // Pagination: 15 per page, newest first, exact boundaries and total count.
      await pool.query(`INSERT INTO admin_audit(actor_id, action, details, created_at)
        SELECT $1, 'bulk_test', 'row ' || n, now() - interval '30 days' - n * interval '1 minute' FROM generate_series(1, 31) n`, [operator.id]);
      const total = (await pool.query('SELECT count(*)::int AS c FROM admin_audit')).rows[0].c as number;
      const pages: Page[] = [];
      for (let n = 1; n <= Math.ceil(total / 15) + 1; n++) {
        const res = await get(`page=${n}`); assert.equal(res.status, 200);
        pages.push(await res.json() as Page);
      }
      assert(pages.every(p => p.total === total && p.pageSize === 15));
      pages.slice(0, -2).forEach(p => assert.equal(p.audit.length, 15));
      assert.equal(pages.at(-2)!.audit.length, total - 15 * (pages.length - 2));
      assert.equal(pages.at(-1)!.audit.length, 0, 'a page past the end is empty, not an error');
      const ids = pages.flatMap(p => p.audit.map(e => e.id));
      assert.equal(new Set(ids).size, total, 'pages do not overlap or skip entries');
      const newestId = (await pool.query('SELECT id FROM admin_audit ORDER BY created_at DESC, id DESC LIMIT 1')).rows[0].id;
      assert.equal(String(pages[0].audit[0].id), String(newestId), 'newest entry first');
      assert.equal(pages.at(-2)!.audit.at(-1)!.action, 'bulk_test', 'oldest entries on the last page');
      for (const bad of ['page=0', 'page=abc', 'page=1&pageSize=101', 'page=-2']) assert.equal((await get(bad)).status, 400, bad);

      // Privacy: no message text, password hashes or session data anywhere in the log or export.
      const json = JSON.stringify(pages);
      const csv = await (await get('format=csv')).text();
      for (const secret of ['private SMS', 'password_hash', 'token_hash', 'secret message body']) {
        assert(!json.includes(secret) && !csv.includes(secret), secret);
      }
      assert.match(csv, /time,actor,target,action,reason,details/);
      assert.match(csv, /Shared lab computer/);
      assert.match(csv, /Server operator \(command line\)/);
      await pool.query("DELETE FROM admin_audit WHERE action IN ('bulk_test', 'legacy_unknown')");
    });
    await t.test('admin overview reports aggregate stats and provider health without message content', async () => {
      await pool.query(
        `INSERT INTO scans(id, user_id, input_type, input_text, state, analysis, threat_intel, incomplete)
         VALUES('ovw1', $1, 'text', 'secret message body', 'PARTIAL', '{"verdict":"MALICIOUS"}'::jsonb,
                '{"urls":[{"url":"https://gcash-verify.top/x","threat":"SOCIAL_ENGINEERING"}]}'::jsonb,
                '["analysis"]'::jsonb)`, [regular.id]);
      const res = await call('/admin/overview', 'GET', undefined, operator.cookie);
      assert.equal(res.status, 200);
      const ov = await res.json() as {
        totalUsers: number; scansToday: number;
        verdictsToday: { safe: number; suspicious: number; malicious: number; inconclusive: number };
        topFlaggedDomains: { domain: string; hits: number }[];
        health: { failedToday: number; providers: { id: string; mode: string; failuresToday: number }[] };
      };
      assert.equal(ov.totalUsers, 2);
      assert(ov.scansToday >= 1);
      assert.equal(ov.verdictsToday.malicious, 1);
      assert(ov.topFlaggedDomains.some(d => d.domain === 'gcash-verify.top' && d.hits === 1));
      assert(ov.health.failedToday >= 1);
      assert.equal(ov.health.providers.find(p => p.id === 'kimi')!.failuresToday, 1);
      assert(ov.health.providers.every(p => p.mode === 'live' || p.mode === 'stub'));
      // Only aggregate numbers: no message text, extraction, or scan ids leak.
      assert.doesNotMatch(JSON.stringify(ov), /secret message body|private SMS|ovw1|extracted/i);
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
      const key = createHash('sha256').update('auth-email:limited@example.com').digest('hex');
      await pool.query('INSERT INTO auth_attempts(key_hash, attempts, window_start) VALUES($1,20,now())', [key]);
      const res = await call('/auth/login', 'POST', { email: 'limited@example.com', password });
      assert.equal(res.status, 429); assert.equal(res.headers.get('retry-after'), '900');
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});

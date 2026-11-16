import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { Pool } from 'pg';

test('storage retention and capacity boundaries against PostgreSQL', async t => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://safetext:safetext@localhost:5432/safetext');
  const admin = new Pool({ connectionString: url.href });
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  process.env.MAX_SCANS_PER_USER = '2'; process.env.MAX_STORED_SCANS = '4';
  process.env.MAX_PENDING_IMAGE_MB = '1'; process.env.MAX_ACCOUNTS = '2';
  process.env.SCAN_RETENTION_DAYS = '30'; process.env.AUDIT_RETENTION_DAYS = '90';
  process.env.KIMI_API_KEY = ''; process.env.LLM_WHISPERER_API_KEY = ''; process.env.GOOGLE_SAFE_BROWSING_API_KEY = '';
  const { pool } = await import('../src/db/pool.js');
  const { migrate } = await import('../src/db/migrate.js');
  const { runStorageMaintenance } = await import('../src/db/retention.js');
  const { createScan, retryImageScan, saveExtraction, saveResult, getScan, getUserScan, listScans } = await import('../src/db/scans.js');
  const { createApp } = await import('../src/app.js');
  const users = [randomUUID(), randomUUID(), randomUUID()];
  async function reset() {
    await pool.query('TRUNCATE sessions, admin_audit, scans, users, auth_attempts, password_resets, scan_reports, domain_lists, settings');
    for (let i = 0; i < users.length; i++) await pool.query(
      'INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [users[i], `fixture${i}@example.com`, 'unused']);
  }
  async function scan(id: string, owner: string, state = 'COMPLETE', days = 0, bytes?: Buffer) {
    await pool.query(`INSERT INTO scans(id,user_id,input_type,state,created_at,updated_at,image_bytes)
      VALUES($1,$2,'image',$3,now() - $4 * interval '1 day',now() - $4 * interval '1 day',$5)`, [id, owner, state, days, bytes ?? null]);
  }
  try {
    await migrate();
    await t.test('expires finished history and metadata, preserves recent work, clears abandoned screenshots', async () => {
      await reset();
      await scan('old', users[0], 'COMPLETE', 31);
      await scan('abandoned', users[0], 'EXTRACTING', 2, Buffer.from('old image'));
      await scan('running', users[1], 'QUEUED', 0, Buffer.from('current image'));
      await pool.query(`INSERT INTO sessions VALUES('expired',$1,now() - interval '1 hour'),('valid',$1,now() + interval '1 hour')`, [users[0]]);
      await pool.query(`INSERT INTO auth_attempts VALUES('old',1,now() - interval '2 days'),('recent',1,now())`);
      await pool.query(`INSERT INTO admin_audit(actor_id,target_id,action,created_at)
        VALUES($1,$2,'disable',now() - interval '91 days'),($1,$2,'enable',now())`, [users[0], users[1]]);
      await runStorageMaintenance();
      assert.equal((await pool.query("SELECT id FROM scans WHERE id = 'old'")).rowCount, 0);
      const stale = (await pool.query("SELECT * FROM scans WHERE id = 'abandoned'")).rows[0];
      assert.equal(stale.state, 'INCONCLUSIVE'); assert.equal(stale.image_bytes, null);
      const running = (await pool.query("SELECT * FROM scans WHERE id = 'running'")).rows[0];
      assert.equal(running.state, 'QUEUED'); assert(running.image_bytes.length);
      assert.deepEqual((await pool.query('SELECT token_hash FROM sessions')).rows, [{ token_hash: 'valid' }]);
      assert.deepEqual((await pool.query('SELECT key_hash FROM auth_attempts')).rows, [{ key_hash: 'recent' }]);
      assert.deepEqual((await pool.query('SELECT action FROM admin_audit')).rows, [{ action: 'enable' }]);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 3);
    });
    await t.test('evicts oldest owned finished scan and keeps other accounts and active jobs', async () => {
      await reset(); await scan('old-owned', users[0], 'COMPLETE', 2); await scan('active-owned', users[0], 'QUEUED');
      await scan('other-account', users[1], 'COMPLETE', 3);
      await createScan({ id: 'new', userId: users[0], inputType: 'text', inputText: 'Hello' });
      assert.deepEqual((await pool.query('SELECT id FROM scans ORDER BY id')).rows.map(r => r.id), ['active-owned', 'new', 'other-account']);
    });
    await t.test('global cap holds for concurrent submissions without deleting running jobs', async () => {
      await reset();
      for (let i = 0; i < 3; i++) await scan(`finished${i}`, users[i], 'COMPLETE', 3 - i);
      await Promise.all(users.map((userId, i) => createScan({ id: `new${i}`, userId, inputType: 'text', inputText: 'Hello' })));
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM scans')).rows[0].count, 4);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM scans WHERE state = 'QUEUED'")).rows[0].count, 3);
    });
    await t.test('full active history rejects admission and rolls back tentative eviction', async () => {
      await reset(); await scan('active1', users[0], 'QUEUED'); await scan('active2', users[0], 'QUEUED');
      await scan('other-finished', users[1]);
      await assert.rejects(createScan({ id: 'rejected', userId: users[0], inputType: 'text', inputText: 'Hello' }), { status: 429 });
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM scans')).rows[0].count, 3);
    });
    await t.test('pending image budget covers fresh uploads and retries; trusted OCR needs no extra bytes', async () => {
      await reset(); await scan('pending', users[0], 'QUEUED', 0, Buffer.alloc(700 * 1024));
      assert((await getScan('pending'))!.image_bytes!.length);
      assert.equal((await getUserScan('pending', users[0]))!.image_bytes, null);
      assert.equal((await listScans(100, users[0]))[0].image_bytes, null);
      await assert.rejects(createScan({ id: 'too-large', userId: users[1], inputType: 'image', imageBytes: Buffer.alloc(400 * 1024) }), { status: 429 });
      await scan('retry', users[1], 'PARTIAL');
      await assert.rejects(retryImageScan('retry', Buffer.alloc(400 * 1024)), { status: 429 });
      assert.equal((await pool.query("SELECT state FROM scans WHERE id = 'retry'")).rows[0].state, 'PARTIAL');
      await pool.query("UPDATE scans SET extracted_text = 'Hello', extraction_source = 'llmwhisperer_v2' WHERE id = 'retry'");
      assert.equal(await retryImageScan('retry', Buffer.alloc(400 * 1024)), true);
      assert.equal((await pool.query("SELECT image_bytes FROM scans WHERE id = 'retry'")).rows[0].image_bytes, null);
    });
    await t.test('oversized extraction and provider output cannot inflate retained rows or claim SAFE', async () => {
      await reset(); await scan('oversized', users[0], 'QUEUED', 0, Buffer.from('image'));
      await assert.rejects(saveExtraction('oversized', 'x'.repeat(10001), null));
      await saveResult('oversized', { state: 'COMPLETE', analysis: { verdict: 'SAFE', confidence: 95,
        reasons: ['x'.repeat(70000)], entities: { senderId: null, urls: [], phoneNumbers: [] } }, threatIntel: null, incomplete: [] });
      const row = (await pool.query("SELECT * FROM scans WHERE id = 'oversized'")).rows[0];
      assert.equal(row.state, 'INCONCLUSIVE'); assert.equal(row.analysis, null); assert.equal(row.image_bytes, null);
      assert(row.incomplete.includes('analysis'));
      await saveResult('oversized', { state: 'COMPLETE', analysis: { verdict: 'MALICIOUS', confidence: 95,
        reasons: ['x'.repeat(70000)], entities: { senderId: null, urls: [], phoneNumbers: [] } },
        threatIntel: { urls: [{ url: 'https://example.com', threat: 'SOCIAL_ENGINEERING' }] }, incomplete: [] });
      const flagged = (await pool.query("SELECT * FROM scans WHERE id = 'oversized'")).rows[0];
      assert.equal(flagged.state, 'PARTIAL'); assert.equal(flagged.analysis.verdict, 'MALICIOUS');
      assert.equal(flagged.threat_intel.urls[0].threat, 'SOCIAL_ENGINEERING');
    });
    await t.test('registration cap and five-session limit are enforced through the API', async () => {
      await reset(); await pool.query('TRUNCATE users CASCADE');
      const server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening');
      try {
        const address = server.address(); assert(address && typeof address !== 'string');
        const base = `http://127.0.0.1:${address.port}/api/v1`;
        const call = (action: string, email: string) => fetch(`${base}/auth/${action}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'a long test password 123' }) });
        const registered = await call('register', 'a@example.com'); assert.equal(registered.status, 201);
        const firstCookie = registered.headers.get('set-cookie')!.split(';')[0];
        for (let i = 0; i < 6; i++) assert.equal((await call('login', 'a@example.com')).status, 200);
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count, 5);
        assert.equal((await fetch(`${base}/auth/me`, { headers: { Cookie: firstCookie } })).status, 401);
        assert.equal((await call('register', 'b@example.com')).status, 201);
        assert.equal((await call('register', 'c@example.com')).status, 503);
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    });
  } finally {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});

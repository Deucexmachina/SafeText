import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { Pool } from "pg";

test("password reset: emailed code, verify, single-use reset, session revocation", async t => {
  // A fresh schema keeps tests away from development accounts and scan data.
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://safetext:safetext@localhost:5432/safetext");
  const admin = new Pool({ connectionString: url.href });
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  // Capture email in the dev outbox instead of delivering it.
  process.env.SMTP_URL = "";
  process.env.BREVO_API_KEY = "";
  process.env.EMAIL_DEV_LOG = "1";
  const { pool } = await import("../src/db/pool.js");
  const { migrate } = await import("../src/db/migrate.js");
  const { createApp } = await import("../src/app.js");
  const { emailSender } = await import("../src/providers/index.js");
  const outbox = emailSender as unknown as { sent: { to: string; text: string }[] };
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  async function call(path: string, method = "GET", body?: unknown, cookie?: string) {
    return fetch(`${base}${path}`, { method, headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  const codeOf = (mail: { text: string }) => mail.text.match(/code: (\d{6})/)![1];
  const password = "a long test password 123";
  const newPassword = "an even longer new password 456";
  async function expireCooldown(email: string) {
    await pool.query("UPDATE auth_attempts SET window_start = now() - interval '2 minutes' WHERE key_hash = $1",
      [createHash('sha256').update(`reset-cooldown:${email}`).digest('hex')]);
  }
  try {
    await migrate();
    const email = "reset@example.com";
    const registered = await call("/auth/register", "POST", { email, password });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get("set-cookie")!.split(";")[0];

    // Unknown address: identical response, nothing emailed.
    const sentBefore = outbox.sent.length;
    const unknown = await call("/auth/forgot-password", "POST", { email: "nobody@example.com" });
    assert.equal(unknown.status, 200);
    assert.equal(outbox.sent.length, sentBefore);

    // Registered address: code emailed and stored only as a hash.
    assert.equal((await call("/auth/forgot-password", "POST", { email })).status, 200);
    assert.equal(outbox.sent.length, sentBefore + 1);
    assert.equal(outbox.sent.at(-1)!.to, email);
    const code = codeOf(outbox.sent.at(-1)!);
    assert.match(code, /^\d{6}$/);
    const { rows: [row] } = await pool.query<{ code_hash: string; expires_at: Date }>(
      "SELECT code_hash, expires_at FROM password_resets");
    assert.notEqual(row.code_hash, code);
    assert(row.expires_at.getTime() > Date.now() && row.expires_at.getTime() <= Date.now() + 5 * 60 * 1000);

    // A resend inside the cooldown does not rotate the code or email again.
    const coolingDown = await call("/auth/forgot-password", "POST", { email });
    assert.equal(coolingDown.status, 429);
    assert(Number(coolingDown.headers.get('retry-after')) > 0);
    assert.equal(outbox.sent.length, sentBefore + 1);
    assert.equal((await pool.query("SELECT count(*)::int AS c FROM password_resets")).rows[0].c, 1);

    // Wrong code rejected; right code verifies without consuming it.
    const wrong = code === "000000" ? "000001" : "000000";
    assert.equal((await call("/auth/verify-reset-code", "POST", { email, code: wrong })).status, 400);
    assert.equal((await call("/auth/verify-reset-code", "POST", { email, code })).status, 200);
    assert.equal((await call("/auth/verify-reset-code", "POST", { email, code })).status, 200);

    // The reset applies the same password rules, then burns the code.
    assert.equal((await call("/auth/reset-password", "POST", { email, code, password: "short" })).status, 400);
    assert.equal((await call("/auth/reset-password", "POST", { email, code, password: newPassword })).status, 200);
    assert.equal((await call("/auth/verify-reset-code", "POST", { email, code })).status, 400);
    assert.equal((await call("/auth/reset-password", "POST", { email, code, password: newPassword })).status, 400);

    // Old sessions are revoked and only the new password logs in.
    assert.equal((await call("/auth/me", "GET", undefined, cookie)).status, 401);
    assert.equal((await call("/auth/login", "POST", { email, password })).status, 401);
    assert.equal((await call("/auth/login", "POST", { email, password: newPassword })).status, 200);
    const { rows: [user] } = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = $1", [email]);
    assert.notEqual(user.password_hash, newPassword);

    // The current policy is five final attempts per minute, with no old daily cap.
    await pool.query("DELETE FROM auth_attempts");
    for (const cycle of [2, 3, 4]) {
      await expireCooldown(email);
      await pool.query("UPDATE password_resets SET created_at = now() - interval '2 minutes'");
      assert.equal((await call("/auth/forgot-password", "POST", { email })).status, 200);
      const cycleCode = codeOf(outbox.sent.at(-1)!);
      const attempt = await call("/auth/reset-password", "POST",
        { email, code: cycleCode, password: `replacement password ${cycle}` });
      assert.equal(attempt.status, 200);
    }
    assert.equal((await call("/auth/login", "POST", { email, password: "replacement password 4" })).status, 200);
    assert.equal((await call("/auth/login", "POST", { email, password: "replacement password 3" })).status, 401);

    // Legacy daily counters do not override the new request-based policy.
    await pool.query("UPDATE users SET password_reset_count = 999, password_reset_window = now() WHERE email = $1", [email]);
    await expireCooldown(email);
    await pool.query("UPDATE password_resets SET created_at = now() - interval '2 minutes'");
    assert.equal((await call("/auth/forgot-password", "POST", { email })).status, 200);
    const rolledCode = codeOf(outbox.sent.at(-1)!);
    assert.equal((await call("/auth/reset-password", "POST",
      { email, code: rolledCode, password: "replacement password 5" })).status, 200);

    // Expired codes are rejected.
    await call("/auth/register", "POST", { email: "second@example.com", password });
    await call("/auth/forgot-password", "POST", { email: "second@example.com" });
    const secondCode = codeOf(outbox.sent.at(-1)!);
    await pool.query("UPDATE password_resets SET expires_at = now() - interval '1 minute'");
    assert.equal((await call("/auth/verify-reset-code", "POST", { email: "second@example.com", code: secondCode })).status, 400);

    // Codes die after too many wrong guesses. Clear the request limiter first —
    // the preceding calls already spent most of its per-IP window.
    await pool.query("DELETE FROM auth_attempts");
    await call("/auth/register", "POST", { email: "third@example.com", password });
    await call("/auth/forgot-password", "POST", { email: "third@example.com" });
    const thirdCode = codeOf(outbox.sent.at(-1)!);
    const thirdWrong = thirdCode === "999999" ? "999998" : "999999";
    for (let i = 0; i < 8; i++) {
      await call("/auth/verify-reset-code", "POST", { email: "third@example.com", code: thirdWrong });
    }
    assert.equal((await call("/auth/verify-reset-code", "POST", { email: "third@example.com", code: thirdCode })).status, 400);

    await t.test('missing email configuration returns the same actionable 503 for all addresses', async () => {
      await pool.query('DELETE FROM auth_attempts');
      const descriptor = Object.getOwnPropertyDescriptor(emailSender, 'configured')!;
      Object.defineProperty(emailSender, 'configured', { value: false, configurable: true });
      try {
        const known = await call('/auth/forgot-password', 'POST', { email });
        const unknown = await call('/auth/forgot-password', 'POST', { email: 'unknown@example.com' });
        assert.equal(known.status, 503); assert.equal(unknown.status, 503);
        const body = await known.json(); assert.deepEqual(await unknown.json(), body);
        assert.match((body as { detail: string }).detail, /temporarily unavailable/);
      } finally { Object.defineProperty(emailSender, 'configured', descriptor); }
    });

    await t.test('concurrent resend requests send one email and concurrent guesses burn every attempt', async () => {
      await pool.query('DELETE FROM auth_attempts');
      await pool.query('DELETE FROM password_resets');
      const before = outbox.sent.length;
      const requests = await Promise.all([1, 2].map(() => call('/auth/forgot-password', 'POST', { email })));
      assert.deepEqual(requests.map(response => response.status).sort(), [200, 429]);
      assert.equal(outbox.sent.length, before + 1);
      const current = codeOf(outbox.sent.at(-1)!);
      const wrong = current === '000000' ? '000001' : '000000';
      const guesses = await Promise.all(Array.from({ length: 8 }, () => call('/auth/verify-reset-code', 'POST', { email, code: wrong })));
      assert(guesses.every(response => response.status === 400));
      const stored = (await pool.query('SELECT attempts, used_at FROM password_resets')).rows[0];
      assert.equal(stored.attempts, 8); assert(stored.used_at);
      assert.equal((await call('/auth/reset-password', 'POST', { email, code: current, password })).status, 400);
    });

    await t.test('delivery failure removes only its undelivered code, logs no secrets, and allows retry after cooldown', async () => {
      await pool.query('DELETE FROM auth_attempts'); await pool.query('DELETE FROM password_resets');
      const originalSend = emailSender.sendPasswordResetCode;
      const originalWarn = console.warn;
      const warnings: unknown[][] = [];
      let failedCode = '';
      emailSender.sendPasswordResetCode = async input => { failedCode = input.code; throw new Error(`private-smtp-credential ${input.to} ${input.code}`); };
      console.warn = (...args: unknown[]) => { warnings.push(args); };
      try {
        assert.equal((await call('/auth/forgot-password', 'POST', { email })).status, 200);
        assert.equal((await pool.query('SELECT * FROM password_resets')).rowCount, 0);
        assert.doesNotMatch(JSON.stringify(warnings), /private-smtp-credential|reset@example/);
        assert(!JSON.stringify(warnings).includes(failedCode));
      } finally { emailSender.sendPasswordResetCode = originalSend; console.warn = originalWarn; }
      const before = outbox.sent.length;
      await expireCooldown(email);
      assert.equal((await call('/auth/forgot-password', 'POST', { email })).status, 200);
      assert.equal(outbox.sent.length, before + 1);
      const current = codeOf(outbox.sent.at(-1)!);
      assert.equal((await call('/auth/verify-reset-code', 'POST', { email, code: current })).status, 200);
    });

    await t.test('an old failed email cannot delete a newer code', async () => {
      await pool.query('DELETE FROM auth_attempts'); await pool.query('DELETE FROM password_resets');
      const originalSend = emailSender.sendPasswordResetCode;
      const originalWarn = console.warn;
      emailSender.sendPasswordResetCode = async () => {
        await pool.query("UPDATE password_resets SET code_hash = 'newer-request-hash'");
        throw new Error('mock delivery failure');
      };
      console.warn = () => {};
      try {
        assert.equal((await call('/auth/forgot-password', 'POST', { email })).status, 200);
        assert.equal((await pool.query('SELECT code_hash FROM password_resets')).rows[0].code_hash, 'newer-request-hash');
      } finally { emailSender.sendPasswordResetCode = originalSend; console.warn = originalWarn; }
    });

    await t.test('concurrent resets consume one code once and cannot re-enable a disabled account', async () => {
      await pool.query('DELETE FROM auth_attempts'); await pool.query('DELETE FROM password_resets');
      await pool.query('UPDATE users SET password_reset_count = 0, password_reset_window = NULL WHERE email = $1', [email]);
      await call('/auth/forgot-password', 'POST', { email });
      const current = codeOf(outbox.sent.at(-1)!);
      const requests = await Promise.all([1, 2].map(() => call('/auth/reset-password', 'POST', { email, code: current, password: newPassword })));
      assert.deepEqual(requests.map(response => response.status).sort(), [200, 400]);
      await pool.query("UPDATE password_resets SET created_at = now() - interval '2 minutes'");
      await expireCooldown(email);
      await call('/auth/forgot-password', 'POST', { email });
      const disabledCode = codeOf(outbox.sent.at(-1)!);
      await pool.query('UPDATE users SET disabled = true WHERE email = $1', [email]);
      assert.equal((await call('/auth/reset-password', 'POST', { email, code: disabledCode, password })).status, 400);
      assert.equal((await pool.query('SELECT disabled FROM users WHERE email = $1', [email])).rows[0].disabled, true);
    });

    await t.test('a login already verifying the old password cannot mint a session after reset', async () => {
      await pool.query('DELETE FROM auth_attempts');
      const raceEmail = 'login-race@example.com';
      assert.equal((await call('/auth/register', 'POST', { email: raceEmail, password })).status, 201);
      const { hashPassword } = await import('../src/http/auth.js');
      const replacement = await hashPassword(newPassword);
      const locker = await pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await locker.query('BEGIN');
        const { rows: [account] } = await locker.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [raceEmail]);
        const pid = (await locker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending = call('/auth/login', 'POST', { email: raceEmail, password });
        // Wait until the login's post-verification write reaches our row lock.
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          blocked = (await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
            WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked`, [pid])).rows[0].blocked;
          if (blocked) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert(blocked, 'login must be in flight while its password is replaced');
        await locker.query('UPDATE users SET password_hash = $2 WHERE id = $1', [account.id, replacement]);
        await locker.query('DELETE FROM sessions WHERE user_id = $1', [account.id]);
        await locker.query('COMMIT');
      } finally { await locker.query('ROLLBACK'); locker.release(); }
      assert.equal((await pending!).status, 401);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1', [raceEmail])).rows[0].count, 0);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

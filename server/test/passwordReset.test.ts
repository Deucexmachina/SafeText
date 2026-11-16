import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { Pool } from "pg";

test("password reset: emailed code, verify, single-use reset, session revocation", async () => {
  // A fresh schema keeps tests away from development accounts and scan data.
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://safetext:safetext@localhost:5432/safetext");
  const admin = new Pool({ connectionString: url.href });
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  // Capture email in the dev outbox instead of delivering it.
  process.env.SMTP_URL = "";
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
    assert.equal((await call("/auth/forgot-password", "POST", { email })).status, 200);
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

    // The same account can reset at most 3 times per rolling day. This user
    // already spent one reset above; two more succeed, the fourth is refused.
    await pool.query("DELETE FROM auth_attempts");
    for (const cycle of [2, 3, 4]) {
      await pool.query("UPDATE password_resets SET created_at = now() - interval '2 minutes'");
      assert.equal((await call("/auth/forgot-password", "POST", { email })).status, 200);
      const cycleCode = codeOf(outbox.sent.at(-1)!);
      const attempt = await call("/auth/reset-password", "POST",
        { email, code: cycleCode, password: `replacement password ${cycle}` });
      if (cycle <= 3) assert.equal(attempt.status, 200);
      else {
        assert.equal(attempt.status, 429);
        assert(Number(attempt.headers.get("retry-after")) > 0);
      }
    }
    assert.equal((await call("/auth/login", "POST", { email, password: "replacement password 3" })).status, 200);
    assert.equal((await call("/auth/login", "POST", { email, password: "replacement password 4" })).status, 401);

    // Once the rolling day passes, resets are allowed again.
    await pool.query("UPDATE users SET password_reset_window = now() - interval '2 days' WHERE email = $1", [email]);
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
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { Pool } from "pg";

test("change password and session management", async t => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://safetext:safetext@localhost:5432/safetext");
  const admin = new Pool({ connectionString: url.href });
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  const { pool } = await import("../src/db/pool.js");
  const { migrate } = await import("../src/db/migrate.js");
  const { createApp } = await import("../src/app.js");
  await migrate();
  const server = createApp().listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const call = (path: string, method = "GET", body?: unknown, cookie = "", ua = "") => fetch(`${base}${path}`, {
    method, headers: { Cookie: cookie, "User-Agent": ua, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const password = "a long test password 123";
  try {
    const registered = await call("/auth/register", "POST", { email: "acct@example.com", password }, "", "Mozilla/5.0 (Windows NT 10.0) Chrome/120");
    assert.equal(registered.status, 201);
    const cookieA = registered.headers.get("set-cookie")!.split(";")[0];
    const login = await call("/auth/login", "POST", { email: "acct@example.com", password }, "", "Mozilla/5.0 (Linux; Android 13) Chrome/120");
    assert.equal(login.status, 200);
    const cookieB = login.headers.get("set-cookie")!.split(";")[0];

    await t.test("sessions list shows each device and marks the current one", async () => {
      const res = await call("/auth/sessions", "GET", undefined, cookieA);
      assert.equal(res.status, 200);
      const { sessions } = await res.json() as { sessions: { id: string; device: string; current: boolean; signedInAt: string }[] };
      assert.equal(sessions.length, 2);
      assert.equal(sessions.filter(s => s.current).length, 1);
      assert(sessions.some(s => /Windows/.test(s.device)));
      assert(sessions.some(s => /Android/.test(s.device)));
      assert.equal((await call("/auth/sessions", "GET", undefined, "safetext_session=bad")).status, 401);
    });

    await t.test("revoking another session signs that device out", async () => {
      const { sessions } = await (await call("/auth/sessions", "GET", undefined, cookieA)).json() as { sessions: { id: string; current: boolean }[] };
      const other = sessions.find(s => !s.current)!;
      assert.equal((await call(`/auth/sessions/${other.id}`, "DELETE", undefined, cookieA)).status, 200);
      const after = await (await call("/auth/sessions", "GET", undefined, cookieA)).json() as { sessions: unknown[] };
      assert.equal(after.sessions.length, 1);
      assert.equal((await call("/auth/me", "GET", undefined, cookieB)).status, 401);
      assert.equal((await call(`/auth/sessions/${other.id}`, "DELETE", undefined, cookieA)).status, 404);
    });

    await t.test("change password requires the current password", async () => {
      assert.equal((await call("/auth/change-password", "POST", { currentPassword: "wrong password!!", password: "brand new password 456" }, cookieA)).status, 401);
      assert.equal((await call("/auth/change-password", "POST", { currentPassword: password, password: "short" }, cookieA)).status, 400);
      assert.equal((await call("/auth/change-password", "POST", { currentPassword: password, password: "brand new password 456" }, cookieA)).status, 200);
      // Current session survives; the new password works for login.
      assert.equal((await call("/auth/me", "GET", undefined, cookieA)).status, 200);
      assert.equal((await call("/auth/login", "POST", { email: "acct@example.com", password: "brand new password 456" })).status, 200);
      assert.equal((await call("/auth/login", "POST", { email: "acct@example.com", password })).status, 401);
    });
  } finally {
    server.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

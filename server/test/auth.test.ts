import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { Pool } from "pg";

test("accounts, sessions, private scans and migrations against PostgreSQL", async () => {
  // A fresh schema keeps tests away from development accounts and scan data.
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://safetext:safetext@localhost:5432/safetext");
  const admin = new Pool({ connectionString: url.href });
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  const { pool } = await import("../src/db/pool.js");
  const { migrate } = await import("../src/db/migrate.js");
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  async function call(path: string, method = "GET", body?: unknown, cookie?: string, origin?: string) {
    return fetch(`${base}${path}`, { method, headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  const password = "a long test password 123";
  try {
    await migrate();
    await pool.query("INSERT INTO scans(id,input_type,input_text) VALUES('legacy','text','Old anonymous scan')");
    await pool.query("CREATE UNIQUE INDEX scans_image_hash_key ON scans(image_hash) WHERE image_hash IS NOT NULL");
    await migrate();
    assert.equal((await call("/health")).status, 200);
    assert.equal((await call("/scans")).status, 401);
    assert.equal((await call("/scan", "POST", { text: "Hello" })).status, 401);
    assert.equal((await call("/auth/register", "POST", { email: "bad", password })).status, 400);
    assert.equal((await call("/auth/register", "POST", { email: "a@example.com", password: "short" })).status, 400);
    const registered = await call("/auth/register", "POST", { email: " A@Example.com ", password });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get("set-cookie")!.split(";")[0];
    assert.match(registered.headers.get("set-cookie")!, /HttpOnly/i);
    assert.match(registered.headers.get("set-cookie")!, /SameSite=Lax/i);
    const { user } = await registered.json() as { user: { email: string; id: string } };
    assert.equal(user.email, "a@example.com");
    assert.equal((await call("/auth/me", "GET", undefined, cookie)).status, 200);
    assert.equal((await call("/auth/register", "POST", { email: user.email, password })).status, 409);
    assert.equal((await call("/auth/login", "POST", { email: user.email, password: "wrong password here" })).status, 401);
    assert.equal((await call("/auth/login", "POST", { email: "unknown@example.com", password })).status, 401);
    assert.equal((await call("/scan", "POST", { text: "Hello" }, cookie, "https://evil.example")).status, 403);
    assert.equal((await call("/auth/logout", "POST", {}, cookie, "https://evil.example")).status, 403);
    const scan = await call("/scan", "POST", { text: "Hello, see you tomorrow." }, cookie);
    assert.equal(scan.status, 202);
    const { scanId } = await scan.json() as { scanId: string };
    let completed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await call(`/scan/${scanId}`, "GET", undefined, cookie);
      assert.equal(result.status, 200);
      if ((await result.json() as { status: string }).status !== "RUNNING") { completed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(completed, "scan pipeline must finish");
    const second = await call("/auth/register", "POST", { email: "b@example.com", password });
    const secondCookie = second.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await call(`/scan/${scanId}`, "GET", undefined, secondCookie)).status, 404);
    assert.deepEqual(await (await call("/scans", "GET", undefined, secondCookie)).json(), { scans: [] });
    assert.equal((await call("/scan/legacy", "GET", undefined, cookie)).status, 404);

    async function image(session: string) {
      const data = new FormData();
      data.append("file", new Blob(["test image bytes"], { type: "image/png" }), "sms.png");
      const res = await fetch(`${base}/scan`, { method: "POST", headers: { Cookie: session }, body: data });
      assert.equal(res.status, 202);
      return await res.json() as { scanId: string; deduplicated?: boolean };
    }
    const firstImage = await image(cookie);
    assert.deepEqual(await image(cookie), { scanId: firstImage.scanId, deduplicated: true });
    const otherImage = await image(secondCookie);
    assert.notEqual(otherImage.scanId, firstImage.scanId);
    // Wait for the in-process queue before dropping the isolated schema.
    for (let i = 0; i < 200; i++) {
      const { rows } = await pool.query("SELECT id FROM scans WHERE state IN ('QUEUED','EXTRACTING','ANALYZING')");
      if (!rows.length) break;
      // Legacy anonymous row is intentionally left queued; ignore it.
      if (rows.every(row => row.id === "legacy")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [user.id]);
    assert.notEqual(rows[0].password_hash, password);
    assert.equal((await call("/auth/logout", "POST", {}, cookie)).status, 200);
    assert.equal((await call("/auth/me", "GET", undefined, cookie)).status, 401);
    const login = await call("/auth/login", "POST", { email: user.email, password });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await (await call("/scans?limit=1.5", "GET", undefined, loginCookie)).json() as { scans: unknown[] }).scans.length, 1);
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    assert.equal((await call("/auth/me", "GET", undefined, loginCookie)).status, 401);
    for (let i = 0; i < 21; i++) {
      const response = await call("/auth/login", "POST", { email: user.email, password: "short" });
      if (i === 20) assert.equal(response.status, 429);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { Pool } from "pg";
import type { ScanResultDto } from "../src/domain/types.js";

test("domain lists, reports, runtime settings and maintenance mode", async t => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://safetext:safetext@localhost:5432/safetext");
  const admin = new Pool({ connectionString: url.href });
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  const { pool } = await import("../src/db/pool.js");
  const { migrate } = await import("../src/db/migrate.js");
  const { analyzer, threatIntel } = await import("../src/providers/index.js");
  analyzer.analyze = async () => ({ verdict: "SAFE", confidence: 82, reasons: ["No scam indicators"], entities: { senderId: null, urls: [], phoneNumbers: [] } });
  threatIntel.lookup = async urls => ({ urls: urls.map(url => ({ url, threat: null })) });
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const call = (path: string, method = "GET", body?: unknown, cookie = "") => fetch(`${base}${path}`, {
    method, headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  async function register(email: string) {
    const res = await call("/auth/register", "POST", { email, password: "a long test password 123" });
    assert.equal(res.status, 201);
    const { user } = await res.json() as { user: { id: string } };
    return { id: user.id, cookie: res.headers.get("set-cookie")!.split(";")[0] };
  }
  async function finished(response: Response, cookie: string): Promise<ScanResultDto> {
    assert.equal(response.status, 202);
    const { scanId } = await response.json() as { scanId: string };
    for (let i = 0; i < 100; i++) {
      const dto = await (await call(`/scan/${scanId}`, "GET", undefined, cookie)).json() as ScanResultDto;
      if (dto.status !== "RUNNING") return dto;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("scan did not finish");
  }
  try {
    await migrate();
    const operator = await register("admin@example.com");
    const user = await register("user@example.com");
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [operator.id]);

    await t.test("blocklisted domain forces a malicious verdict even with clean providers", async () => {
      assert.equal((await call("/admin/domains", "POST", { domain: "https://gcash-verify.top/login", list: "block" }, operator.cookie)).status, 200);
      assert.equal((await call("/admin/domains", "POST", { domain: "bad", list: "other" }, operator.cookie)).status, 400);
      assert.equal((await call("/admin/domains", "POST", { domain: "x", list: "block" }, operator.cookie)).status, 400);
      assert.equal((await call("/admin/domains", "GET", undefined, user.cookie)).status, 403);
      const { rows } = await (await call("/admin/domains", "GET", undefined, operator.cookie)).json() as { rows: { domain: string }[] };
      assert.equal(rows[0].domain, "gcash-verify.top");
      const dto = await finished(await call("/scan", "POST", { text: "Verify your GCash at https://sub.gcash-verify.top/now" }, user.cookie), user.cookie);
      assert.equal(dto.analysis?.verdict, "MALICIOUS");
      assert(dto.analysis!.confidence >= 90);
      assert.equal(dto.threatIntel?.urls[0].threat, "MANUAL_BLOCK");
      assert(dto.analysis!.reasons.some(r => /blocklist/.test(r)));
      const { rows: [scan] } = await pool.query<{ scam_category: string }>("SELECT scam_category FROM scans WHERE id = $1", [dto.scanId]);
      assert.equal(scan.scam_category, "gcash_bank");
    });

    await t.test("allowlisted domain clears a provider threat", async () => {
      threatIntel.lookup = async urls => ({ urls: urls.map(url => ({ url, threat: "SOCIAL_ENGINEERING" as const })) });
      assert.equal((await call("/admin/domains", "POST", { domain: "gcash.com", list: "allow" }, operator.cookie)).status, 200);
      const dto = await finished(await call("/scan", "POST", { text: "Top up at https://gcash.com/pay" }, user.cookie), user.cookie);
      assert.equal(dto.analysis?.verdict, "SAFE");
      assert.equal(dto.threatIntel?.urls[0].threat, null);
      // Moving the domain to the blocklist re-flags it.
      assert.equal((await call("/admin/domains", "POST", { domain: "gcash.com", list: "block" }, operator.cookie)).status, 200);
      const flagged = await finished(await call("/scan", "POST", { text: "Top up at https://gcash.com/pay" }, user.cookie), user.cookie);
      assert.equal(flagged.analysis?.verdict, "MALICIOUS");
      assert.equal((await call("/admin/domains/gcash.com", "DELETE", undefined, operator.cookie)).status, 200);
      assert.equal((await call("/admin/domains/gcash.com", "DELETE", undefined, operator.cookie)).status, 404);
      threatIntel.lookup = async urls => ({ urls: urls.map(url => ({ url, threat: null })) });
    });

    await t.test("wrong-result reports honour the share-text consent", async () => {
      const dto = await finished(await call("/scan", "POST", { text: "Secret SMS body about a parcel" }, user.cookie), user.cookie);
      assert.equal((await call(`/scan/${dto.scanId}/report`, "POST", { expectedVerdict: "SUSPICIOUS" }, user.cookie)).status, 200);
      let reports = await (await call("/admin/reports", "GET", undefined, operator.cookie)).json() as { rows: { shared: boolean; text: string | null }[] };
      assert.equal(reports.rows.length, 1);
      assert.equal(reports.rows[0].shared, false);
      assert.equal(reports.rows[0].text, null);
      assert.equal((await call(`/scan/${dto.scanId}/report`, "POST", { expectedVerdict: "SUSPICIOUS", includeMessage: true }, user.cookie)).status, 200);
      reports = await (await call("/admin/reports", "GET", undefined, operator.cookie)).json() as { rows: { shared: boolean; text: string | null }[]; missedScams: number };
      assert.equal(reports.rows[0].shared, true);
      assert.match(reports.rows[0].text ?? "", /parcel/);
      assert.equal(reports.missedScams, 1);
      assert.equal((await call(`/scan/${dto.scanId}/report`, "POST", { expectedVerdict: "SUSPICIOUS" }, operator.cookie)).status, 404);
      assert.equal((await call(`/scan/${dto.scanId}/report`, "POST", { expectedVerdict: "BROKEN" }, user.cookie)).status, 400);
    });

    await t.test("runtime settings update limits, retention policy and validation", async () => {
      const before = await (await call("/admin/settings", "GET", undefined, operator.cookie)).json() as { scansPer15Min: number; maxUploadMb: number };
      assert.equal(before.scansPer15Min, 20);
      assert.equal(before.maxUploadMb, 8);
      assert.equal((await call("/admin/settings", "PUT", { maxUploadMb: 99 }, operator.cookie)).status, 400);
      assert.equal((await call("/admin/settings", "PUT", { scanRetentionDays: 45, announcement: "New: faster link checks" }, operator.cookie)).status, 200);
      const policy = await (await call("/storage-policy", "GET", undefined, user.cookie)).json() as { scanRetentionDays: number };
      assert.equal(policy.scanRetentionDays, 45);
      const status = await (await call("/status")).json() as { maintenance: boolean; announcement: string };
      assert.equal(status.announcement, "New: faster link checks");
      assert.equal(status.maintenance, false);
      assert.equal((await call("/admin/settings", "PUT", { announcement: "" }, operator.cookie)).status, 200);
    });

    await t.test("announcement type and end time: validated, shown on status, hidden once expired, audited", async () => {
      type Status = { announcement: string; announcementType: string; announcementUntil: string | null };
      const status = async () => await (await call("/status")).json() as Status;
      // Defaults: information, no end time.
      assert.equal((await call("/admin/settings", "PUT", { announcement: "Exams week" }, operator.cookie)).status, 200);
      assert.deepEqual(await status(), { maintenance: false, announcement: "Exams week", announcementType: "info", announcementUntil: null } as unknown as Status);
      // Validation.
      for (const bad of [{ announcementType: "urgent" }, { announcementUntil: "not a date" }, { announcementUntil: 12 },
        { announcementUntil: new Date(Date.now() - 60_000).toISOString() }, { announcementUntil: new Date(Date.now() + 400 * 86_400_000).toISOString() }]) {
        assert.equal((await call("/admin/settings", "PUT", bad, operator.cookie)).status, 400, JSON.stringify(bad));
      }
      // Warning with a future end time is shown with both.
      const until = new Date(Date.now() + 3 * 86_400_000).toISOString();
      assert.equal((await call("/admin/settings", "PUT", { announcementType: "warning", announcementUntil: until }, operator.cookie)).status, 200);
      let shown = await status();
      assert.equal(shown.announcementType, "warning"); assert.equal(shown.announcementUntil, until); assert.equal(shown.announcement, "Exams week");
      const settings = await (await call("/admin/settings", "GET", undefined, operator.cookie)).json() as { announcementType: string; announcementUntil: string };
      assert.equal(settings.announcementType, "warning"); assert.equal(settings.announcementUntil, until);
      // The change is audited in plain words.
      const audit = await (await call("/admin/audit?page=1", "GET", undefined, operator.cookie)).json() as { audit: { action: string; view: { changes: { label: string; before: string; after: string }[] } }[] };
      const changes = audit.audit.find(e => e.action === "update_settings")!.view.changes;
      assert.deepEqual(changes.find(c => c.label === "Announcement type"), { label: "Announcement type", before: "Information", after: "Warning" });
      assert.match(changes.find(c => c.label === "Announcement ends")!.after, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
      // Once the end time passes, users no longer get the announcement (admins still see it in Settings).
      await pool.query("UPDATE settings SET value = $1 WHERE key = 'announcement_until'", [new Date(Date.now() - 1000).toISOString()]);
      shown = await status();
      assert.equal(shown.announcement, ""); assert.equal(shown.announcementUntil, null);
      const adminView = await (await call("/admin/settings", "GET", undefined, operator.cookie)).json() as { announcement: string };
      assert.equal(adminView.announcement, "Exams week");
      // Clearing the end time shows it again until removed.
      assert.equal((await call("/admin/settings", "PUT", { announcementUntil: null, announcementType: "info" }, operator.cookie)).status, 200);
      assert.equal((await status()).announcement, "Exams week");
      assert.equal((await call("/admin/settings", "PUT", { announcement: "" }, operator.cookie)).status, 200);
    });

    await t.test("maintenance mode pauses new scans and shows on public status", async () => {
      assert.equal((await call("/admin/settings", "PUT", { maintenance: true }, operator.cookie)).status, 200);
      const status = await (await call("/status")).json() as { maintenance: boolean };
      assert.equal(status.maintenance, true);
      const blocked = await call("/scan", "POST", { text: "test" }, user.cookie);
      assert.equal(blocked.status, 503);
      assert.equal((await call("/admin/settings", "PUT", { maintenance: false }, operator.cookie)).status, 200);
      assert.equal((await call("/scan", "POST", { text: "hello" }, user.cookie)).status, 202);
    });

    await t.test("overview trends expose categories only", async () => {
      const overview = await (await call("/admin/overview", "GET", undefined, operator.cookie)).json() as { scamTrends7d: { category: string; count: number }[] };
      const gcash = overview.scamTrends7d.find(row => row.category === "gcash_bank");
      assert(gcash && gcash.count >= 1);
      assert(!JSON.stringify(overview).includes("parcel"));
    });
  } finally {
    server.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

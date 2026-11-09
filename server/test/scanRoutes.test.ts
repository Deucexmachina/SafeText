import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { Pool } from "pg";
import type { ScanResultDto } from "../src/domain/types.js";
import { ProviderError } from "../src/providers/resilience.js";

test("authenticated scan routes: text, screenshots, errors, retry and input validation", async () => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://safetext:safetext@localhost:5432/safetext");
  const admin = new Pool({ connectionString: url.href });
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  const { pool } = await import("../src/db/pool.js");
  const { migrate } = await import("../src/db/migrate.js");
  const { ocr, analyzer, threatIntel } = await import("../src/providers/index.js");
  let ocrCalls = 0;
  let analyzed = 0;
  let ocrText = "Pay now at https://example.com";
  let failAnalysis = false;
  let failIntel = false;
  ocr.extract = async () => { ocrCalls++; return { text: ocrText, senderId: null, confidence: 0 }; };
  analyzer.analyze = async ({ text }) => {
    analyzed++; assert(text.trim());
    if (failAnalysis) throw new ProviderError("Kimi", "test outage", { status: 503 });
    return { verdict: "SAFE", confidence: 80, reasons: ["No scam indicators"], entities: { senderId: null, urls: [], phoneNumbers: [] } };
  };
  threatIntel.lookup = async urls => {
    if (failIntel) throw new ProviderError("Google Safe Browsing", "test outage", { status: 503 });
    return { urls: urls.map(url => ({ url, threat: null })) };
  };
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  let cookie = "";
  const json = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5gAAAABJRU5ErkJggg==", "base64");
  async function upload(bytes = png, text?: string, mime = "image/png") {
    const form = new FormData(); form.append("file", new Blob([bytes], { type: mime }), "sms.png");
    if (text !== undefined) form.append("text", text);
    return fetch(`${base}/scan`, { method: "POST", headers: { Cookie: cookie }, body: form });
  }
  async function finished(response: Response): Promise<ScanResultDto> {
    assert.equal(response.status, 202);
    const { scanId } = await response.json() as { scanId: string };
    for (let i = 0; i < 100; i++) {
      const result = await fetch(`${base}/scan/${scanId}`, { headers: { Cookie: cookie } });
      const dto = await result.json() as ScanResultDto;
      if (dto.status !== "RUNNING") return dto;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("scan did not finish");
  }
  try {
    await migrate();
    const registered = await json("/auth/register", { email: "scan@example.com", password: "a long test password 123" });
    assert.equal(registered.status, 201); cookie = registered.headers.get("set-cookie")!.split(";")[0];
    const text = await finished(await json("/scan", { text: "  Hello tomorrow  " }));
    assert.equal(text.status, "COMPLETE"); assert.equal(ocrCalls, 0);
    assert.equal(text.extraction?.text.trim(), "Hello tomorrow"); assert.match(text.createdAt, /Z$/); assert.equal(text.error, null);
    assert.equal((await json("/scan", { text: " " })).status, 400);
    assert.equal((await upload(png, "pasted SMS")).status, 400);
    assert.equal((await upload(Buffer.from("fake png"))).status, 415);
    assert.equal((await upload(png, undefined, "image/svg+xml")).status, 415);
    assert.equal((await upload(Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413);
    const screenshot = await finished(await upload());
    assert.equal(screenshot.status, "COMPLETE"); assert.equal(ocrCalls, 1);
    assert.equal(screenshot.extraction?.text, ocrText); assert.equal(screenshot.threatIntel?.urls[0].url, "https://example.com");
    const saved = await pool.query("SELECT image_bytes FROM scans WHERE id = $1", [screenshot.scanId]);
    assert.equal(saved.rows[0].image_bytes, null);
    await finished(await upload()); assert.equal(ocrCalls, 1);

    // A completed legacy stub scan used to be returned forever by image hash.
    await pool.query("UPDATE scans SET extraction_source = NULL, extracted_text = 'Shopee sample text', sender_id = 'SHOPEE-PH' WHERE id = $1", [screenshot.scanId]);
    const legacyResponse = await fetch(`${base}/scan/${screenshot.scanId}`, { headers: { Cookie: cookie } });
    const legacy = await legacyResponse.json() as ScanResultDto;
    assert.equal(legacy.status, "INCONCLUSIVE"); assert.equal(legacy.analysis, null); assert.equal(legacy.extraction, null);
    assert.match(legacy.error ?? "", /Upload the screenshot again/);
    const history = await (await fetch(`${base}/scans`, { headers: { Cookie: cookie } })).json() as { scans: { scanId: string; preview: string | null; verdict: string | null }[] };
    assert.equal(history.scans.find(scan => scan.scanId === screenshot.scanId)?.preview, null);
    ocrText = "AMAZON: You have been fined for failing to return your order";
    const fresh = await finished(await upload());
    assert.equal(fresh.scanId, screenshot.scanId); assert.equal(ocrCalls, 2);
    assert.equal(fresh.extraction?.text, ocrText); assert.doesNotMatch(JSON.stringify(fresh), /Shopee|SHOPEE/);
    await finished(await upload()); assert.equal(ocrCalls, 2, "verified real OCR may still be cached");

    ocrText = "  "; const callsBefore = analyzed;
    const unreadable = await finished(await upload(Buffer.concat([png, Buffer.from("different")] )));
    assert.equal(unreadable.status, "INCONCLUSIVE"); assert.equal(analyzed, callsBefore);
    assert.match(unreadable.error ?? "", /could not be read/);

    failAnalysis = true;
    const failed = await finished(await json("/scan", { text: "https://example.com" }));
    assert.equal(failed.status, "INCONCLUSIVE"); assert.deepEqual(failed.incomplete, ["analysis"]);
    assert.match(failed.error ?? "", /Kimi.*503/);

    failAnalysis = false; failIntel = true; ocrText = "https://example.com";
    const retryBytes = Buffer.concat([png, Buffer.from("retry")]);
    const partial = await finished(await upload(retryBytes));
    assert.equal(partial.status, "PARTIAL"); assert.equal(partial.analysis?.verdict, "INCONCLUSIVE");
    const beforeRetry = ocrCalls; failIntel = false;
    const retried = await finished(await upload(retryBytes));
    assert.equal(retried.scanId, partial.scanId); assert.equal(retried.status, "COMPLETE");
    assert.equal(ocrCalls, beforeRetry, "retry should reuse persisted extraction");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});

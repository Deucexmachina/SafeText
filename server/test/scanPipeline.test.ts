import assert from "node:assert/strict";
import { test } from "node:test";
import { processScan } from "../src/queue/scanQueue.js";
import type { ScanRow, FinalResult } from "../src/db/scans.js";
import type { AnalysisResult } from "../src/domain/types.js";
import { LlmWhispererOcrProvider } from "../src/providers/ocr/LlmWhispererOcrProvider.js";
import { ProviderError } from "../src/providers/resilience.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5gAAAABJRU5ErkJggg==", "base64");
const analysis: AnalysisResult = { verdict: "SUSPICIOUS", confidence: 75, reasons: ["Urgent payment request"], entities: { senderId: null, urls: [], phoneNumbers: [] } };
function harness(inputType: "text" | "image", text = "  Pay now https://example.com\r\n") {
  const row = { id: "test", state: "QUEUED", input_type: inputType, input_text: text, image_bytes: PNG, image_mime: "image/png", extracted_text: null, sender_id: null } as ScanRow;
  let final: FinalResult | undefined;
  let ocrCalls = 0;
  const analyzed: string[] = [];
  const links: string[][] = [];
  const deps = {
    getScan: async () => row,
    setState: async () => {},
    saveExtraction: async (_id: string, extracted: string) => { row.extracted_text = extracted; row.image_bytes = null; },
    saveResult: async (_id: string, result: FinalResult) => { final = result; row.image_bytes = null; },
    ocr: { extract: async () => { ocrCalls++; return { text, senderId: null, confidence: 0 }; } },
    analyzer: { analyze: async (input: { text: string }) => { assert.equal(row.image_bytes, null); analyzed.push(input.text); return analysis; } },
    threatIntel: { lookup: async (urls: string[]) => { links.push(urls); return { urls: urls.map(url => ({ url, threat: null })) }; } },
  };
  return { row, deps, analyzed, links, get final() { return final; }, get ocrCalls() { return ocrCalls; } };
}

test("IT-01: pasted SMS skips OCR and uses normalized text", async () => {
  const h = harness("text");
  await processScan("test", h.deps);
  assert.equal(h.ocrCalls, 0);
  assert.deepEqual(h.analyzed, ["Pay now https://example.com"]);
  assert.equal(h.final?.state, "COMPLETE");
});

test("CT-01/IT-01: screenshot binary submit -> poll -> one-time retrieve -> persisted text -> analysis", async () => {
  const h = harness("image");
  const calls: string[] = [];
  h.deps.ocr = new LlmWhispererOcrProvider({ apiKey: "test-secret", baseUrl: "https://ocr.example/api/v2", pollDelayMs: 0,
    guard: { maxRequests: 100, timeoutMs: 1000 },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input)); calls.push(url.pathname);
      assert.equal((init?.headers as Record<string, string>)["unstract-key"], "test-secret");
      if (url.pathname.endsWith("/whisper")) {
        assert.equal(init?.method, "POST"); assert.deepEqual(Buffer.from(init?.body as Uint8Array), PNG);
        return Response.json({ whisper_hash: "job hash" }, { status: 202 });
      }
      assert.equal(url.searchParams.get("whisper_hash"), "job hash");
      if (url.pathname.endsWith("whisper-status")) return Response.json({ status: calls.length === 2 ? "processing" : "processed" });
      return Response.json({ result_text: " Pay now https://example.com\r\n" });
    },
  });
  await processScan("test", h.deps);
  assert.equal(calls.filter(path => path.endsWith("whisper-retrieve")).length, 1);
  assert.equal(h.row.extracted_text, " Pay now https://example.com\r\n");
  assert.equal(h.row.image_bytes, null);
  assert.deepEqual(h.analyzed, ["Pay now https://example.com"]);
  assert.deepEqual(h.links, [["https://example.com"]]);
  assert.equal(h.final?.state, "COMPLETE");
});

test("FT-01: unreadable OCR is INCONCLUSIVE, never sent to Kimi, and bytes are discarded", async () => {
  const h = harness("image", " \n\u200B <<< !!! ");
  await processScan("test", h.deps);
  assert.equal(h.final?.state, "INCONCLUSIVE");
  assert.match(h.final?.error ?? "", /could not be read/);
  assert.deepEqual(h.analyzed, []);
  assert.deepEqual(h.links, []);
  assert.equal(h.row.image_bytes, null);
});

test("restart resumes stored extraction without another OCR job", async () => {
  const h = harness("image"); h.row.extracted_text = "Saved SMS"; h.row.extraction_source = "llmwhisperer_v2"; h.row.image_bytes = null;
  await processScan("test", h.deps);
  assert.equal(h.ocrCalls, 0); assert.deepEqual(h.analyzed, ["Saved SMS"]);
});

test("legacy sample extraction cannot bypass real OCR or contaminate the message", async () => {
  const h = harness("image", "AMAZON: return your order");
  h.row.extracted_text = "Shopee sample text"; h.row.extraction_source = null;
  await processScan("test", h.deps);
  assert.equal(h.ocrCalls, 1);
  assert.deepEqual(h.analyzed, ["AMAZON: return your order"]);
});

test("legacy extraction without original bytes requests a new upload instead of analyzing samples", async () => {
  const h = harness("image"); h.row.extracted_text = "Shopee sample text"; h.row.image_bytes = null;
  await processScan("test", h.deps);
  assert.equal(h.ocrCalls, 0); assert.equal(h.analyzed.length, 0);
  assert.equal(h.final?.state, "INCONCLUSIVE"); assert.match(h.final?.error ?? "", /upload it again/);
});

test("FT-02: Kimi failure keeps URL fallback and sanitized error", async () => {
  const h = harness("text");
  h.deps.analyzer.analyze = async () => { throw new ProviderError("Kimi", "request rejected", { status: 401 }); };
  await processScan("test", h.deps);
  assert.equal(h.final?.state, "INCONCLUSIVE"); assert.deepEqual(h.final?.incomplete, ["analysis"]);
  assert.match(h.final?.error ?? "", /Kimi.*401/); assert.equal(h.links.length, 1);
});

test("unexpected failures never echo arbitrary error contents", async () => {
  const h = harness("image"); h.deps.ocr.extract = async () => { throw new Error("secret payload"); };
  await processScan("test", h.deps);
  assert.equal(h.final?.state, "INCONCLUSIVE"); assert.doesNotMatch(h.final?.error ?? "", /secret payload/);
  assert.equal(h.row.image_bytes, null);
});

for (const status of ["error", "retrieved", "unknown"]) {
  test(`OCR handles terminal/invalid status ${status}`, async () => {
    let calls = 0;
    const ocr = new LlmWhispererOcrProvider({ apiKey: "test", baseUrl: "https://ocr.example/api/v2", fetchImpl: async () => Response.json(++calls === 1 ? { whisper_hash: "h" } : { status }) });
    await assert.rejects(() => ocr.extract({ bytes: PNG, mimeType: "image/png" }), ProviderError);
    assert.equal(calls, 2);
  });
}

test("OCR bounds polling and does not retrieve unfinished jobs", async () => {
  let calls = 0;
  const ocr = new LlmWhispererOcrProvider({ apiKey: "test", baseUrl: "https://ocr.example/api/v2", maxPolls: 2, pollDelayMs: 0,
    fetchImpl: async () => Response.json(++calls === 1 ? { whisper_hash: "h" } : { status: "accepted" }) });
  await assert.rejects(() => ocr.extract({ bytes: PNG, mimeType: "image/png" }), /timed out/);
  assert.equal(calls, 3);
});

test("OCR authentication error is sanitized and submit is not retried", async () => {
  let calls = 0;
  const ocr = new LlmWhispererOcrProvider({ apiKey: "secret", baseUrl: "https://ocr.example/api/v2", fetchImpl: async () => { calls++; return new Response("secret message", { status: 401 }); } });
  await assert.rejects(() => ocr.extract({ bytes: PNG, mimeType: "image/png" }), err => err instanceof ProviderError && err.status === 401 && !err.message.includes("secret"));
  assert.equal(calls, 1);
});

test("OCR retries temporary status failures but never repeats one-time retrieval", async () => {
  let statusCalls = 0; let retrieves = 0;
  const ocr = new LlmWhispererOcrProvider({ apiKey: "test", baseUrl: "https://ocr.example/api/v2", guard: { retryDelayMs: 1 },
    fetchImpl: async input => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/whisper")) return Response.json({ whisper_hash: "h" });
      if (path.endsWith("whisper-status")) return ++statusCalls === 1 ? new Response("", { status: 503 }) : Response.json({ status: "processed" });
      retrieves++; return new Response("", { status: 503 });
    } });
  await assert.rejects(() => ocr.extract({ bytes: PNG, mimeType: "image/png" }), ProviderError);
  assert.equal(statusCalls, 2); assert.equal(retrieves, 1);
});

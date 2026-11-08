import assert from "node:assert/strict";
import { test } from "node:test";
import { KimiScamAnalyzer } from "../src/providers/analyzer/KimiScamAnalyzer.js";
import { GoogleSafeBrowsingThreatIntel } from "../src/providers/threatintel/GoogleSafeBrowsingThreatIntel.js";
import { ProviderError } from "../src/providers/resilience.js";
import { combineScanResults } from "../src/domain/verdicts.js";
import type { AnalysisResult } from "../src/domain/types.js";

// All tests use injected mock fetch implementations — no live calls, no keys.

const FAST = { retries: 0, timeoutMs: 1000, retryDelayMs: 1 };

function kimiBody(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const VALID_KIMI = {
  verdict: "SUSPICIOUS",
  confidence: 72,
  reasons: ["Creates urgency"],
  entities: {
    senderId: "BANK",
    urls: ["https://secure-login.top"],
    phoneNumbers: [],
  },
};

test("Kimi: valid JSON output is parsed into an AnalysisResult", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    return kimiBody(VALID_KIMI);
  };
  const analyzer = new KimiScamAnalyzer({
    apiKey: "test-key",
    fetchImpl,
    guard: FAST,
  });
  const result = await analyzer.analyze({
    text: "URGENT verify at https://secure-login.top",
    senderId: "BANK",
  });
  assert.equal(calls, 1);
  assert.equal(result.verdict, "SUSPICIOUS");
  assert.equal(result.confidence, 72);
  assert.deepEqual(result.reasons, ["Creates urgency"]);
  assert.equal(result.entities.senderId, "BANK");
  assert.ok(result.entities.urls.includes("https://secure-login.top"));
});

test("Kimi: malformed output triggers one retry with a stricter prompt", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    seen.push(JSON.parse(String(init?.body)).messages[1].content);
    return seen.length === 1
      ? new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 })
      : kimiBody(VALID_KIMI);
  };
  const analyzer = new KimiScamAnalyzer({
    apiKey: "test-key",
    fetchImpl,
    guard: FAST,
  });
  const result = await analyzer.analyze({ text: "claim your prize now" });
  assert.equal(seen.length, 2);
  assert.match(seen[1], /previous reply was not valid/);
  assert.equal(result.verdict, "SUSPICIOUS");
});

test("Kimi: still-malformed output after retry raises a provider error", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "garbage" } }] }),
      { status: 200 },
    );
  };
  const analyzer = new KimiScamAnalyzer({
    apiKey: "test-key",
    fetchImpl,
    guard: FAST,
  });
  await assert.rejects(
    () => analyzer.analyze({ text: "hello" }),
    (err: unknown) => {
      assert(err instanceof ProviderError);
      assert.equal(err.provider, "Kimi");
      assert.match(err.message, /malformed JSON/);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("Kimi: out-of-range confidence is rejected as malformed", async () => {
  const fetchImpl: typeof fetch = async () =>
    kimiBody({ ...VALID_KIMI, confidence: 900 });
  const analyzer = new KimiScamAnalyzer({
    apiKey: "test-key",
    fetchImpl,
    guard: FAST,
  });
  await assert.rejects(() => analyzer.analyze({ text: "x" }), ProviderError);
});

test("Kimi: 5xx is retried once; 4xx is not", async () => {
  let calls = 0;
  const flaky: typeof fetch = async () => {
    calls++;
    return calls === 1
      ? new Response("boom", { status: 500 })
      : kimiBody(VALID_KIMI);
  };
  const analyzer = new KimiScamAnalyzer({
    apiKey: "test-key",
    fetchImpl: flaky,
    guard: { ...FAST, retries: 1 },
  });
  const ok = await analyzer.analyze({ text: "hello there friend" });
  assert.equal(ok.verdict, "SUSPICIOUS");
  assert.equal(calls, 2);

  calls = 0;
  const forbidden: typeof fetch = async () => {
    calls++;
    return new Response("no", { status: 403 });
  };
  const analyzer403 = new KimiScamAnalyzer({
    apiKey: "test-key",
    fetchImpl: forbidden,
    guard: { ...FAST, retries: 1 },
  });
  await assert.rejects(
    () => analyzer403.analyze({ text: "hi" }),
    (err: unknown) => {
      assert(err instanceof ProviderError);
      assert.equal(err.status, 403);
      assert.equal(err.retryable, false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("Kimi: missing API key fails with a clear, non-retryable error", async () => {
  let calls = 0;
  const analyzer = new KimiScamAnalyzer({
    apiKey: "",
    fetchImpl: async () => {
      calls++;
      return kimiBody(VALID_KIMI);
    },
    guard: FAST,
  });
  await assert.rejects(
    () => analyzer.analyze({ text: "hi" }),
    /KIMI_API_KEY is not configured/,
  );
  assert.equal(calls, 0);
});

test("Google: flagged URL maps to its threat type, clean URLs stay null", async () => {
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.match(String(url), /threatMatches:find\?key=test-key$/);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.threatInfo.threatTypes, [
      "MALWARE",
      "SOCIAL_ENGINEERING",
      "UNWANTED_SOFTWARE",
    ]);
    return new Response(
      JSON.stringify({
        matches: [
          {
            threatType: "SOCIAL_ENGINEERING",
            platformType: "ANY_PLATFORM",
            threat: { url: "https://phish.example" },
            threatEntryType: "URL",
          },
        ],
      }),
      { status: 200 },
    );
  };
  const intel = new GoogleSafeBrowsingThreatIntel({
    apiKey: "test-key",
    fetchImpl,
    guard: FAST,
  });
  const result = await intel.lookup([
    "https://phish.example",
    "https://safe.example",
  ]);
  assert.deepEqual(result, {
    urls: [
      { url: "https://phish.example", threat: "SOCIAL_ENGINEERING" },
      { url: "https://safe.example", threat: null },
    ],
  });
});

test("Google: response without matches leaves every threat null", async () => {
  const intel = new GoogleSafeBrowsingThreatIntel({
    apiKey: "test-key",
    fetchImpl: async () => new Response("{}", { status: 200 }),
    guard: FAST,
  });
  const result = await intel.lookup(["https://safe.example"]);
  assert.deepEqual(result, {
    urls: [{ url: "https://safe.example", threat: null }],
  });
});

test("Google: empty input returns an empty result without calling the API", async () => {
  let calls = 0;
  const intel = new GoogleSafeBrowsingThreatIntel({
    apiKey: "test-key",
    fetchImpl: async () => {
      calls++;
      return new Response("{}", { status: 200 });
    },
    guard: FAST,
  });
  assert.deepEqual(await intel.lookup([]), { urls: [] });
  assert.equal(calls, 0);
});

test("Google: missing API key fails with a clear error", async () => {
  const intel = new GoogleSafeBrowsingThreatIntel({
    apiKey: "",
    fetchImpl: async () => new Response("{}", { status: 200 }),
    guard: FAST,
  });
  await assert.rejects(
    () => intel.lookup(["https://x.example"]),
    /GOOGLE_SAFE_BROWSING_API_KEY is not configured/,
  );
});

const SAFE_ANALYSIS: AnalysisResult = {
  verdict: "SAFE",
  confidence: 88,
  reasons: ["No common scam indicators detected"],
  entities: { senderId: null, urls: ["https://phish.example"], phoneNumbers: [] },
};

const FLAGGED_INTEL = {
  urls: [{ url: "https://phish.example", threat: "SOCIAL_ENGINEERING" as const }],
};

test("pipeline: flagged URL escalates any verdict to MALICIOUS >= 90", () => {
  const r = combineScanResults(SAFE_ANALYSIS, FLAGGED_INTEL, "see https://phish.example", null);
  assert.equal(r.state, "COMPLETE");
  assert.equal(r.analysis?.verdict, "MALICIOUS");
  assert.equal(r.analysis?.confidence, 90);
  assert.match(r.analysis?.reasons[0] ?? "", /phish\.example.*SOCIAL_ENGINEERING/);
});

test("pipeline: Kimi failure + flagged URL still yields a malicious result", () => {
  const r = combineScanResults(
    null,
    FLAGGED_INTEL,
    "verify now at https://phish.example",
    "BANK",
  );
  assert.equal(r.state, "PARTIAL");
  assert.deepEqual(r.incomplete, ["analysis"]);
  assert.equal(r.analysis?.verdict, "MALICIOUS");
  assert.ok((r.analysis?.confidence ?? 0) >= 90);
  assert.equal(r.analysis?.entities.senderId, "BANK");
  assert.ok(r.analysis?.entities.urls.includes("https://phish.example"));
});

test("pipeline: Google failure + Kimi success is PARTIAL", () => {
  const r = combineScanResults(SAFE_ANALYSIS, null, "hi", null);
  assert.equal(r.state, "PARTIAL");
  assert.deepEqual(r.incomplete, ["threat_intel"]);
  assert.equal(r.analysis?.verdict, "SAFE");
});

test("pipeline: both providers failing is INCONCLUSIVE", () => {
  const r = combineScanResults(null, null, "hi", null);
  assert.equal(r.state, "INCONCLUSIVE");
  assert.equal(r.analysis, null);
  assert.deepEqual(r.incomplete, ["analysis", "threat_intel"]);
});

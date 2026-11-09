import type { OcrProvider } from "./OcrProvider.js";
import type { OcrResult } from "../../domain/types.js";
import { sleep } from "../../lib/sleep.js";
import { assertOk, ProviderError, ProviderGuard, type ProviderGuardOptions } from "../resilience.js";
import { validImage } from "./imageValidation.js";

const PROVIDER = "LLMWhisperer";
interface Options {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  guard?: Partial<ProviderGuardOptions>;
  pollDelayMs?: number;
  maxPolls?: number;
  deadlineMs?: number;
}

export class LlmWhispererOcrProvider implements OcrProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly guard: ProviderGuard;
  private readonly pollGuard: ProviderGuard;
  constructor(private readonly opts: Options) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    // Never retry submit or one-time retrieval: an uncertain response may
    // already have created a paid job or consumed the extraction.
    this.guard = new ProviderGuard(PROVIDER, { ...opts.guard, retries: 0 });
    this.pollGuard = new ProviderGuard(PROVIDER, opts.guard);
  }

  async extract(input: { bytes: Buffer; mimeType: string }): Promise<OcrResult> {
    if (!this.opts.apiKey) throw new ProviderError(PROVIDER, "LLM_WHISPERER_API_KEY is not configured; add it to server/.env");
    if (!validImage(input.bytes, input.mimeType)) throw new ProviderError(PROVIDER, "use a PNG, JPEG, WEBP, GIF, BMP or TIFF screenshot up to 8 MB");
    const deadline = AbortSignal.timeout(this.opts.deadlineMs ?? 120_000);
    const call = async (path: string, query: Record<string, string>, bytes?: Buffer): Promise<Record<string, unknown>> => {
      return (path === "whisper-status" ? this.pollGuard : this.guard).run(async (signal) => {
        const url = new URL(`${this.opts.baseUrl.replace(/\/$/, "")}/${path}`);
        url.search = new URLSearchParams(query).toString();
        const response = await this.fetchImpl(url, {
          method: bytes ? "POST" : "GET",
          signal: AbortSignal.any([signal, deadline]),
          redirect: "error",
          headers: { "unstract-key": this.opts.apiKey, ...(bytes ? { "Content-Type": "application/octet-stream" } : {}) },
          ...(bytes ? { body: new Uint8Array(bytes) } : {}),
        });
        assertOk(PROVIDER, response);
        let data: unknown;
        try { data = await response.json(); } catch { throw new ProviderError(PROVIDER, "returned an unreadable response"); }
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new ProviderError(PROVIDER, "returned an invalid response");
        return data as Record<string, unknown>;
      });
    };
    const submitted = await call("whisper", { mode: "high_quality", output_mode: "text" }, input.bytes);
    if (typeof submitted.whisper_hash !== "string" || !submitted.whisper_hash) throw new ProviderError(PROVIDER, "did not return a job ID");
    const query = { whisper_hash: submitted.whisper_hash };
    for (let attempt = 0; attempt < (this.opts.maxPolls ?? 30); attempt++) {
      if (deadline.aborted) break;
      const status = await call("whisper-status", query);
      if (status.status === "processed") {
        const result = await call("whisper-retrieve", query);
        if (typeof result.result_text !== "string") throw new ProviderError(PROVIDER, "did not return extracted text");
        // Return immediately so the queue persists one-time extraction before
        // invoking downstream providers. Empty text is handled by the queue.
        return { text: result.result_text, senderId: null, confidence: 0 };
      }
      if (status.status === "error") throw new ProviderError(PROVIDER, "could not read this screenshot; try a clearer image or paste the SMS text");
      if (status.status === "retrieved") throw new ProviderError(PROVIDER, "extraction was already retrieved; upload a new screenshot");
      if (status.status !== "accepted" && status.status !== "processing") throw new ProviderError(PROVIDER, "returned an unknown job status");
      await sleep(Math.min((this.opts.pollDelayMs ?? 500) * 2 ** attempt, 3000));
    }
    throw new ProviderError(PROVIDER, "screenshot processing timed out; try again later", { retryable: true });
  }
}

import { sleep } from "../lib/sleep.js";

// Error thrown by external providers. Never carries API keys or message text.
export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number | undefined;
  // True when the call may succeed if tried again (timeout, 429, 5xx,
  // transport failure, or an open circuit that will close later).
  readonly retryable: boolean;

  constructor(
    provider: string,
    detail: string,
    opts?: { status?: number; retryable?: boolean; cause?: unknown },
  ) {
    const status = opts?.status !== undefined ? ` (HTTP ${opts.status})` : "";
    super(`${provider}: ${detail}${status}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = opts?.status;
    this.retryable = opts?.retryable ?? false;
    if (opts?.cause !== undefined) this.cause = opts.cause;
  }
}

// Sliding-window rate limiter: at most `max` calls per `windowMs`.
class RateLimiter {
  private stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length < this.max) {
        this.stamps.push(now);
        return;
      }
      await sleep(this.windowMs - (now - this.stamps[0]) + 1);
    }
  }
}

// Opens after `threshold` consecutive failures and fails fast for
// `cooldownMs`, then allows a single trial call again.
class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly provider: string,
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (Date.now() < this.openUntil) {
      throw new ProviderError(
        this.provider,
        `temporarily disabled after ${this.threshold} consecutive failures; try again later`,
        { retryable: true },
      );
    }
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (err) {
      if (++this.failures >= this.threshold) {
        this.openUntil = Date.now() + this.cooldownMs;
        this.failures = 0;
      }
      throw err;
    }
  }
}

export interface ProviderGuardOptions {
  maxRequests: number;
  windowMs: number;
  timeoutMs: number;
  // Extra attempts after the first, for retryable failures only.
  retries: number;
  retryDelayMs: number;
  breakerThreshold: number;
  breakerCooldownMs: number;
}

export const DEFAULT_GUARD: ProviderGuardOptions = {
  maxRequests: 5,
  windowMs: 10_000,
  timeoutMs: 15_000,
  retries: 1,
  retryDelayMs: 1_000,
  breakerThreshold: 3,
  breakerCooldownMs: 30_000,
};

// Wraps a provider call with rate limiting, a circuit breaker, a per-attempt
// timeout, and retries for temporary failures only.
export class ProviderGuard {
  private readonly limiter: RateLimiter;
  private readonly breaker: CircuitBreaker;
  private readonly opts: ProviderGuardOptions;

  constructor(
    private readonly provider: string,
    opts?: Partial<ProviderGuardOptions>,
  ) {
    this.opts = { ...DEFAULT_GUARD, ...opts };
    this.limiter = new RateLimiter(this.opts.maxRequests, this.opts.windowMs);
    this.breaker = new CircuitBreaker(
      provider,
      this.opts.breakerThreshold,
      this.opts.breakerCooldownMs,
    );
  }

  async run<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    await this.limiter.acquire();
    return this.breaker.exec(() => this.attempt(call));
  }

  private async attempt<T>(
    call: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await call(AbortSignal.timeout(this.opts.timeoutMs));
      } catch (err) {
        const wrapped = toProviderError(this.provider, err);
        if (!wrapped.retryable || i >= this.opts.retries) throw wrapped;
        await sleep(this.opts.retryDelayMs * (i + 1));
      }
    }
  }
}

export function toProviderError(provider: string, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  ) {
    return new ProviderError(provider, "request timed out", {
      retryable: true,
      cause: err,
    });
  }
  // fetch() throws TypeError for DNS/connection/reset failures — transient.
  if (err instanceof TypeError) {
    return new ProviderError(provider, "network request failed", {
      retryable: true,
      cause: err,
    });
  }
  return new ProviderError(provider, "request failed", {
    retryable: false,
    cause: err,
  });
}

// Throws a ProviderError for non-2xx responses; 429 and 5xx are retryable.
export function assertOk(provider: string, res: Response): void {
  if (res.ok) return;
  throw new ProviderError(provider, "request rejected", {
    status: res.status,
    retryable: res.status === 429 || res.status >= 500,
  });
}

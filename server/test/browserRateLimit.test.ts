import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, forgotPassword } from '../../web/src/api.js';

test('browser API carries numeric and HTTP-date retry delays to reset forms and polling', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const header of ['45', new Date(Date.now() + 45_000).toUTCString()]) {
      globalThis.fetch = async () => Response.json({ title: 'Request limit reached', detail: 'Too many requests.' },
        { status: 429, headers: { 'Retry-After': header } });
      await assert.rejects(forgotPassword('test@example.com'), err => {
        assert(err instanceof ApiError); assert.equal(err.status, 429);
        assert(err.retryAfter! > 0 && err.retryAfter! <= 45);
        assert.match(err.detail, /Try again in \d+ seconds/); return true;
      });
    }
    globalThis.fetch = async () => Response.json({ detail: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': 'invalid' } });
    await assert.rejects(forgotPassword('test@example.com'), err => err instanceof ApiError && err.retryAfter === null);
    globalThis.fetch = async () => Response.json({ ok: true, resendAfter: 90 });
    assert.deepEqual(await forgotPassword('test@example.com'), { ok: true, resendAfter: 90 });
  } finally { globalThis.fetch = originalFetch; }
});

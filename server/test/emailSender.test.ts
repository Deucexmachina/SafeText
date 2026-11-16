import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrevoEmailSender, EmailDeliveryError, parseSender } from '../src/providers/email/BrevoEmailSender.js';
import { createEmailSender } from '../src/providers/email/createEmailSender.js';
import { DevEmailSender } from '../src/providers/email/DevEmailSender.js';
import { DisabledEmailSender } from '../src/providers/email/DisabledEmailSender.js';

test('email selection prefers HTTPS, disables production code logging, and requires a real sender', () => {
  const defaults = { brevoApiKey: '', smtpUrl: '', emailFrom: 'SafeText <no-reply@safetext.local>', emailDevLog: false, production: true };
  assert(createEmailSender(defaults) instanceof DisabledEmailSender);
  assert(createEmailSender({ ...defaults, emailDevLog: true }) instanceof DisabledEmailSender);
  assert(createEmailSender({ ...defaults, emailDevLog: true, production: false }) instanceof DevEmailSender);
  assert.equal(createEmailSender({ ...defaults, brevoApiKey: 'test' }).configured, false);
  assert(createEmailSender({ ...defaults, brevoApiKey: 'test', emailFrom: 'SafeText <sender@example.com>',
    smtpUrl: 'smtps://unused.example.com' }) instanceof BrevoEmailSender);
  assert.deepEqual(parseSender('SafeText <sender@example.com>'), { name: 'SafeText', email: 'sender@example.com' });
  assert.deepEqual(parseSender('sender@example.com'), { email: 'sender@example.com' });
  assert.equal(parseSender('sender@example.com\r\nBcc: victim@example.com'), null);
});

test('Brevo contract sends a code over HTTPS with bounded timeout and validates acceptance', async () => {
  let calls = 0;
  const sender = new BrevoEmailSender({ apiKey: 'test-key', from: 'SafeText <sender@example.com>', fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email'); assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error'); assert(init?.signal instanceof AbortSignal);
    assert.equal((init?.headers as Record<string, string>)['api-key'], 'test-key');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.sender, { name: 'SafeText', email: 'sender@example.com' });
    assert.deepEqual(body.to, [{ email: 'recipient@example.com' }]);
    assert.match(body.textContent, /012345/); assert.match(body.textContent, /5 minutes/);
    assert.match(body.htmlContent, /012345/); assert.match(body.htmlContent, /5 minutes/);
    assert.equal(body.subject, 'Your SafeText password reset code');
    return Response.json({ messageId: '<fixture-message@example.com>' }, { status: 201 });
  } });
  await sender.sendPasswordResetCode({ to: 'recipient@example.com', code: '012345', expiresMinutes: 5 });
  assert.equal(calls, 1);
});

test('Brevo failures redact sensitive response details, never auto-retry, and reject malformed acceptance', async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    const sender = new BrevoEmailSender({ apiKey: 'private-key', from: 'sender@example.com', fetchImpl: async () => {
      calls++; return new Response('private-key recipient@example.com reset-code-123456', { status });
    } });
    await assert.rejects(sender.sendPasswordResetCode({ to: 'recipient@example.com', code: '123456', expiresMinutes: 5 }), err => {
      assert(err instanceof EmailDeliveryError); assert.equal(err.status, status);
      assert.doesNotMatch(err.message, /private-key|recipient@|123456/); return true;
    });
    assert.equal(calls, 1);
  }
  const malformed = new BrevoEmailSender({ apiKey: 'test', from: 'sender@example.com', fetchImpl: async () => Response.json({}) });
  await assert.rejects(malformed.sendPasswordResetCode({ to: 'recipient@example.com', code: '123456', expiresMinutes: 5 }), EmailDeliveryError);
});

test('Brevo times out without exposing request contents', async () => {
  const sender = new BrevoEmailSender({ apiKey: 'test', from: 'sender@example.com', timeoutMs: 10,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('mock timeout did not abort')), 1000);
      init!.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('private-network-details')); }, { once: true });
    }) });
  await assert.rejects(sender.sendPasswordResetCode({ to: 'recipient@example.com', code: '123456', expiresMinutes: 5 }), err =>
    err instanceof EmailDeliveryError && !err.message.includes('private-network-details'));
});

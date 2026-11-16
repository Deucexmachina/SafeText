import type { EmailSender } from './EmailSender.js';
import { resetEmail } from './resetEmail.js';

export function parseSender(from: string): { email: string; name?: string } | null {
  if (/[\r\n]/.test(from)) return null;
  const match = from.trim().match(/^(?:([^<>]+?)\s*<([^<>]+)>|([^<>]+))$/);
  if (!match) return null;
  const email = (match[2] ?? match[3]).trim();
  if (!/^[^\s@]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || /@[^@]*\.local$/i.test(email)) return null;
  return { email, ...(match[1] ? { name: match[1].trim().replace(/^"|"$/g, '') } : {}) };
}

export class EmailDeliveryError extends Error {
  constructor(readonly status?: number) {
    // Never include provider payloads, recipients, reset codes, or credentials.
    super('Email delivery failed. Check email provider configuration and delivery logs.');
    this.name = 'EmailDeliveryError';
  }
}

/** HTTPS delivery works on Render Free, where standard outbound SMTP ports are blocked. */
export class BrevoEmailSender implements EmailSender {
  readonly configured = true;
  private readonly sender: { email: string; name?: string };
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: { apiKey: string; from: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    const sender = parseSender(options.from);
    if (!sender) throw new Error('EMAIL_FROM must be a verified real sender email address.');
    this.sender = sender;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  async sendPasswordResetCode(input: { to: string; code: string; expiresMinutes: number }): Promise<void> {
    const mail = resetEmail(input);
    try {
      const response = await this.fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        headers: { 'api-key': this.options.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: this.sender, to: [{ email: input.to }], subject: mail.subject, textContent: mail.text, htmlContent: mail.html }),
      });
      // Do not retry email submission automatically: an uncertain response may already have sent a code.
      if (!response.ok) { await response.body?.cancel(); throw new EmailDeliveryError(response.status); }
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('messageId' in data) || typeof data.messageId !== 'string' || !data.messageId) {
        throw new EmailDeliveryError();
      }
    } catch (err) {
      if (err instanceof EmailDeliveryError) throw err;
      throw new EmailDeliveryError();
    }
  }
}

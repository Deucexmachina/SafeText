import type { EmailSender } from './EmailSender.js';
import { BrevoEmailSender, parseSender } from './BrevoEmailSender.js';
import { SmtpEmailSender } from './SmtpEmailSender.js';
import { DevEmailSender } from './DevEmailSender.js';
import { DisabledEmailSender } from './DisabledEmailSender.js';

export function createEmailSender(options: {
  brevoApiKey: string; smtpUrl: string; emailFrom: string; emailDevLog: boolean; production: boolean;
}): EmailSender {
  // An HTTPS key takes precedence over old SMTP settings left in Render.
  if (options.brevoApiKey) return parseSender(options.emailFrom)
    ? new BrevoEmailSender({ apiKey: options.brevoApiKey, from: options.emailFrom }) : new DisabledEmailSender();
  if (options.smtpUrl) return parseSender(options.emailFrom)
    ? new SmtpEmailSender({ smtpUrl: options.smtpUrl, from: options.emailFrom }) : new DisabledEmailSender();
  if (options.emailDevLog && !options.production) return new DevEmailSender();
  return new DisabledEmailSender();
}

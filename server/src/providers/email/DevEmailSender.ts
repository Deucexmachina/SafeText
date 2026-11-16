import type { EmailSender } from "./EmailSender.js";
import { resetEmail } from "./resetEmail.js";

export interface SentMail {
  to: string;
  subject: string;
  text: string;
}

// Development stand-in: logs the email and keeps it in memory so tests and
// local development work without SMTP credentials. Never use in production.
export class DevEmailSender implements EmailSender {
  readonly sent: SentMail[] = [];

  async sendPasswordResetCode(input: {
    to: string;
    code: string;
    expiresMinutes: number;
  }): Promise<void> {
    const mail = resetEmail(input);
    this.sent.push({ to: input.to, ...mail });
    console.log(`[dev-email] password reset code for ${input.to}: ${input.code}`);
  }
}

import type { EmailSender } from "./EmailSender.js";

// Selected when neither SMTP_URL nor EMAIL_DEV_LOG is configured. Throws so
// the caller logs a warning; responses still stay generic to avoid leaking
// which addresses are registered.
export class DisabledEmailSender implements EmailSender {
  readonly configured = false;
  async sendPasswordResetCode(): Promise<never> {
    throw new Error(
      "Email delivery is not configured. Set BREVO_API_KEY and EMAIL_FROM for Render, or configure SMTP elsewhere.",
    );
  }
}

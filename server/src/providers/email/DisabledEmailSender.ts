import type { EmailSender } from "./EmailSender.js";

// Selected when neither SMTP_URL nor EMAIL_DEV_LOG is configured. Throws so
// the caller logs a warning; responses still stay generic to avoid leaking
// which addresses are registered.
export class DisabledEmailSender implements EmailSender {
  async sendPasswordResetCode(): Promise<never> {
    throw new Error(
      "Email delivery is not configured. Set SMTP_URL, or EMAIL_DEV_LOG=1 for local development.",
    );
  }
}

import nodemailer, { type Transporter } from "nodemailer";
import type { EmailSender } from "./EmailSender.js";
import { resetEmail } from "./resetEmail.js";

// Real delivery over SMTP (Gmail app password, Brevo, SendGrid SMTP, ...).
// Configure with SMTP_URL, e.g. smtps://user%40gmail.com:pass@smtp.gmail.com
export class SmtpEmailSender implements EmailSender {
  readonly configured = true;
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(options: { smtpUrl: string; from: string }) {
    this.transport = nodemailer.createTransport({ url: options.smtpUrl,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
      logger: false, debug: false,
    });
    this.from = options.from;
  }

  async sendPasswordResetCode(input: {
    to: string;
    code: string;
    expiresMinutes: number;
  }): Promise<void> {
    const mail = resetEmail(input);
    await this.transport.sendMail({
      from: this.from,
      to: input.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  }
}

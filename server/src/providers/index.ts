import { config } from "../config.js";
import type { OcrProvider } from "./ocr/OcrProvider.js";
import type { ScamAnalyzer } from "./analyzer/ScamAnalyzer.js";
import type { UrlThreatIntel } from "./threatintel/UrlThreatIntel.js";
import { LlmWhispererOcrProvider } from "./ocr/LlmWhispererOcrProvider.js";
import { KimiScamAnalyzer } from "./analyzer/KimiScamAnalyzer.js";
import { GoogleSafeBrowsingThreatIntel } from "./threatintel/GoogleSafeBrowsingThreatIntel.js";
import type { EmailSender } from "./email/EmailSender.js";
import { SmtpEmailSender } from "./email/SmtpEmailSender.js";
import { DevEmailSender } from "./email/DevEmailSender.js";
import { DisabledEmailSender } from "./email/DisabledEmailSender.js";

export const ocr: OcrProvider = new LlmWhispererOcrProvider({
  apiKey: config.llmWhispererApiKey,
  baseUrl: config.llmWhispererBaseUrl,
});
export const analyzer: ScamAnalyzer = new KimiScamAnalyzer({
  apiKey: config.kimiApiKey,
  model: config.kimiModel,
});
export const threatIntel: UrlThreatIntel = new GoogleSafeBrowsingThreatIntel({
  apiKey: config.safeBrowsingApiKey,
});

// Password-reset email: real SMTP when configured, console-backed outbox for
// development/tests, otherwise a sender that logs a clear warning.
export const emailSender: EmailSender = config.smtpUrl
  ? new SmtpEmailSender({ smtpUrl: config.smtpUrl, from: config.emailFrom })
  : config.emailDevLog
    ? new DevEmailSender()
    : new DisabledEmailSender();

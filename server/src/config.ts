import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// Resolve independently of cwd (npm dev, compiled startup, and tests differ).
loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

if (process.env.NODE_ENV === 'production') {
  let validOrigin = false;
  let validDatabase = false;
  try { const origin = new URL(process.env.APP_ORIGIN ?? ''); validOrigin = origin.protocol === 'https:' && origin.origin === process.env.APP_ORIGIN; } catch { /* Never echo invalid environment values. */ }
  try { const database = new URL(process.env.DATABASE_URL ?? ''); validDatabase = ['postgres:', 'postgresql:'].includes(database.protocol) && !!database.password && database.password !== 'safetext'; } catch { /* Never echo credentials. */ }
  if (!validOrigin) throw new Error('Production requires APP_ORIGIN as an HTTPS origin without a trailing slash.');
  if (!validDatabase) throw new Error('Production requires DATABASE_URL with non-default database credentials.');
}

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}.`);
  }
  return value;
}

const clientIpSource = process.env.CLIENT_IP_SOURCE ?? 'socket';
if (!['socket', 'render'].includes(clientIpSource)) throw new Error('CLIENT_IP_SOURCE must be socket or render.');
if (clientIpSource === 'render' && process.env.RENDER !== 'true') {
  throw new Error('CLIENT_IP_SOURCE=render is only supported on a public Render web service. Use socket locally.');
}

export const config = {
  clientIpSource,
  apiRateLimitPerMinute: positiveInteger('API_RATE_LIMIT_PER_MINUTE', 300, 100000),
  authRateLimitPerIp: positiveInteger('AUTH_RATE_LIMIT_PER_IP', 100, 10000),
  authRateLimitPerEmail: positiveInteger('AUTH_RATE_LIMIT_PER_EMAIL', 20, 1000),
  resetRequestsPerHourPerIp: positiveInteger('RESET_REQUESTS_PER_HOUR_PER_IP', 20, 1000),
  resetRequestsPerHourPerEmail: positiveInteger('RESET_REQUESTS_PER_HOUR_PER_EMAIL', 5, 100),
  resetVerifyPer15MinPerIp: positiveInteger('RESET_VERIFY_PER_15_MIN_PER_IP', 100, 10000),
  resetVerifyPer15MinPerEmail: positiveInteger('RESET_VERIFY_PER_15_MIN_PER_EMAIL', 20, 1000),
  resetPasswordAttemptsPerMinute: positiveInteger('RESET_PASSWORD_ATTEMPTS_PER_MINUTE', 5, 100),
  resetResendCooldownSeconds: positiveInteger('RESET_RESEND_COOLDOWN_SECONDS', 60, 3600),
  resetMaxCodeAttempts: positiveInteger('RESET_MAX_CODE_ATTEMPTS', 8, 20),
  scanRateLimitPer15Min: positiveInteger('SCAN_RATE_LIMIT_PER_15_MIN', 20, 200),
  scanRetentionDays: positiveInteger('SCAN_RETENTION_DAYS', 30, 3650),
  maxScansPerUser: positiveInteger('MAX_SCANS_PER_USER', 100, 100000),
  maxStoredScans: positiveInteger('MAX_STORED_SCANS', 1000, 1000000),
  maxPendingImageMb: positiveInteger('MAX_PENDING_IMAGE_MB', 32, 1024),
  auditRetentionDays: positiveInteger('AUDIT_RETENTION_DAYS', 90, 3650),
  maxAccounts: positiveInteger('MAX_ACCOUNTS', 500, 100000),
  serveWeb: process.env.SERVE_WEB === "true",
  port: Number(process.env.PORT ?? 3001),
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  secureCookies: process.env.NODE_ENV === "production",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://safetext:safetext@localhost:5432/safetext",
  // Provider API keys. Missing keys make only that provider's calls fail
  // with a clear error; the rest of the scan pipeline keeps working.
  llmWhispererApiKey: process.env.LLM_WHISPERER_API_KEY ?? "",
  llmWhispererBaseUrl: process.env.LLM_WHISPERER_BASE_URL ?? "https://llmwhisperer-api.us-central.unstract.com/api/v2",
  kimiApiKey: process.env.KIMI_API_KEY ?? "",
  kimiModel: process.env.KIMI_MODEL ?? "kimi-k3",
  safeBrowsingApiKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY ?? "",
  // Password-reset email delivery. SMTP_URL is a full DSN, e.g.
  // smtps://user%40gmail.com:app-password@smtp.gmail.com — without it,
  // EMAIL_DEV_LOG=1 prints reset emails to the server console (dev only).
  smtpUrl: process.env.SMTP_URL ?? "",
  brevoApiKey: process.env.BREVO_API_KEY?.trim() ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "SafeText <no-reply@safetext.local>",
  emailDevLog: process.env.EMAIL_DEV_LOG === "1" || process.env.EMAIL_DEV_LOG === "true",
};

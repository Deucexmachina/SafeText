import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3001),
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  secureCookies: process.env.NODE_ENV === "production",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://safetext:safetext@localhost:5432/safetext",
  // Provider API keys. Missing keys make only that provider's calls fail
  // with a clear error; the rest of the scan pipeline keeps working.
  llmWhispererApiKey: process.env.LLM_WHISPERER_API_KEY ?? "",
  kimiApiKey: process.env.KIMI_API_KEY ?? "",
  kimiModel: process.env.KIMI_MODEL ?? "kimi-k3",
  safeBrowsingApiKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY ?? "",
};

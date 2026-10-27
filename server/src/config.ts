import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://safetext:safetext@localhost:5432/safetext",
  // Real provider keys — used once the stub adapters are swapped out.
  llmWhispererApiKey: process.env.LLM_WHISPERER_API_KEY ?? "",
  kimiApiKey: process.env.KIMI_API_KEY ?? "",
  safeBrowsingApiKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY ?? "",
};

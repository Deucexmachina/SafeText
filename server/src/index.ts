import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { resetStuckScans } from "./db/scans.js";
import { enqueueScan } from "./queue/scanQueue.js";
import { emailSender } from './providers/index.js';
import { maintainStorage } from './db/retention.js';

async function main() {
  await migrate();
  if (!emailSender.configured) console.warn('Password-reset email is unavailable. Configure BREVO_API_KEY and a verified EMAIL_FROM for Render.');
  await maintainStorage();

  // Re-queue any scans left mid-flight by a previous shutdown.
  for (const id of await resetStuckScans()) enqueueScan(id);

  createApp().listen(config.port, () => {
    console.log(`safetext server listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start; check database connectivity and configuration.", { name: err instanceof Error ? err.name : 'UnknownError' });
  process.exit(1);
});

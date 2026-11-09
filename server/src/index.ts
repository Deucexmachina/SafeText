import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { resetStuckScans } from "./db/scans.js";
import { enqueueScan } from "./queue/scanQueue.js";

async function main() {
  await migrate();

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

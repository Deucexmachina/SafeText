import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

export async function migrate(): Promise<void> {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(dir, "schema.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then(() => {
      console.log("schema applied");
      return pool.end();
    })
    .catch((err) => {
      console.error("Migration failed; check database connectivity and permissions.", { name: err instanceof Error ? err.name : 'UnknownError' });
      process.exit(1);
    });
}

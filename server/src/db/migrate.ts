import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

export async function migrate(): Promise<void> {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(dir, "schema.sql"), "utf8");
  await pool.query(sql);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then(() => {
      console.log("schema applied");
      return pool.end();
    })
    .catch((err) => {
      console.error("migration failed:", err);
      process.exit(1);
    });
}

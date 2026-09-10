import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";
import { logger } from "../utils/logger.js";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query("SELECT pg_advisory_lock(87216401)");
  try {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const { rows } = await pool.query("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.name));

    let appliedCount = 0;

    for (const file of files) {
      if (applied.has(file)) {
        logger.info(`Migration already applied: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        appliedCount += 1;
        logger.info(`Migration applied: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        logger.error(`Migration failed: ${file}`, err);
        throw err;
      } finally {
        client.release();
      }
    }

    return { files, appliedCount };
  } finally {
    await pool.query("SELECT pg_advisory_unlock(87216401)");
  }
}

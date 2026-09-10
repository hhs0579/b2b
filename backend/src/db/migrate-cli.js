import { runMigrations } from "./migrations.js";
import { pool } from "./pool.js";
import { logger } from "../utils/logger.js";

try {
  const result = await runMigrations();
  logger.info(
    `Migrations complete. Files: ${result.files.length}, newly applied: ${result.appliedCount}`,
  );
} catch (err) {
  logger.error("Migration runner failed", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}

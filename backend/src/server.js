import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { logger } from "./utils/logger.js";
import { ensureStorageDirectories } from "./utils/storage.js";
import { syncInvoiceMasterChecksum, warnInvoiceMasterStatus } from "./domain/invoice-master.js";

ensureStorageDirectories();
warnInvoiceMasterStatus();

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
});

pool
  .query("SELECT 1")
  .then(async () => {
    logger.info("Database connected");
    try {
      const master = await syncInvoiceMasterChecksum();
      if (master.ok) {
        logger.info(`Invoice MASTER checksum stored (${master.sha256.slice(0, 12)}…)`);
      }
    } catch (err) {
      logger.warn(`Invoice MASTER checksum sync skipped: ${err.message}`);
    }
  })
  .catch((err) => {
    logger.error("Database connection failed", err);
  });

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down`);
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

import { pool } from "../db/pool.js";
import { logger } from "./logger.js";
import { deleteStoredOrderFile } from "./order-files.js";

export async function deleteOrderUploadAfterCommit(storedFileName) {
  try {
    await deleteStoredOrderFile(storedFileName);
  } catch (err) {
    logger.error("Order upload file delete failed after DB commit", err);
    try {
      await pool.query(
        `
          INSERT INTO storage_orphan_files (stored_file_name, file_kind, reason)
          VALUES ($1, 'ORDER_UPLOAD', $2)
        `,
        [storedFileName, err.message || "file delete failed"],
      );
    } catch (logErr) {
      logger.error("Failed to record orphan upload file", logErr);
    }
  }
}

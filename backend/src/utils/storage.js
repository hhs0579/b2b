import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

const REQUIRED_DIRECTORIES = [
  "masters",
  path.join("uploads", "orders"),
  path.join("generated", "invoices"),
];

export function ensureStorageDirectories() {
  for (const relative of REQUIRED_DIRECTORIES) {
    const dir = path.join(env.STORAGE_ROOT, relative);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`Created storage directory: ${dir}`);
    }
  }
}

import pg from "pg";
import { databaseConfig } from "../config/database.js";
import { logger } from "../utils/logger.js";

pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool(databaseConfig);

pool.on("error", (err) => {
  logger.error("Unexpected database pool error", err);
});

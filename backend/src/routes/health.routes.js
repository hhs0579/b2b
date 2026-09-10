import { Router } from "express";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { logger } from "../utils/logger.js";

const router = Router();

router.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      ok: true,
      service: "b2b-backend",
      database: "connected",
      environment: env.NODE_ENV,
    });
  } catch (err) {
    logger.error("Database health check failed", err);
    res.status(503).json({
      ok: false,
      service: "b2b-backend",
      database: "disconnected",
    });
  }
});

export default router;

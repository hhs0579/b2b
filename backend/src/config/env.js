import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true });

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

function parseCorsOrigin(value) {
  if (!value) {
    return isProduction ? [] : ["http://localhost:5173"];
  }
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const corsOrigin = parseCorsOrigin(process.env.CORS_ORIGIN);

if (isProduction && (corsOrigin.length === 0 || corsOrigin.includes("*"))) {
  throw new Error("CORS_ORIGIN must be set to a specific origin in production.");
}

function parseDatabaseUrl(urlString) {
  const url = new URL(urlString);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function loadDatabaseConfig() {
  if (process.env.DATABASE_URL) {
    return parseDatabaseUrl(process.env.DATABASE_URL);
  }

  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;

  if (!database || !user) {
    throw new Error(
      "Database configuration is missing. Set DATABASE_URL or DB_NAME and DB_USER.",
    );
  }

  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    database,
    user,
    password: process.env.DB_PASSWORD ?? "",
  };
}

const storageRootInput = process.env.STORAGE_ROOT || "../storage";

export const env = {
  NODE_ENV,
  isProduction,
  PORT: Number(process.env.PORT || 3000),
  CORS_ORIGIN: corsOrigin.length === 1 ? corsOrigin[0] : corsOrigin,
  STORAGE_ROOT: path.isAbsolute(storageRootInput)
    ? storageRootInput
    : path.resolve(backendRoot, storageRootInput),
  UPLOAD_MAX_BYTES: Number(process.env.UPLOAD_MAX_BYTES || 20 * 1024 * 1024),
  EXCEL_MAX_SHEETS: Number(process.env.EXCEL_MAX_SHEETS || 50),
  EXCEL_MAX_ROWS: Number(process.env.EXCEL_MAX_ROWS || 20000),
  EXCEL_MAX_COLS: Number(process.env.EXCEL_MAX_COLS || 200),
  database: loadDatabaseConfig(),
  backendRoot,
};

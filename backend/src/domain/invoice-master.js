import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { AppError } from "../utils/app-error.js";
import { logger } from "../utils/logger.js";
import { FROZEN_PARTS } from "./invoice-template-map.js";
import {
  isSamePath,
  masterDir,
  masterManifestPath,
  masterPath,
  sourceInvoicePath as defaultSourceInvoicePath,
} from "./invoice-master-paths.js";
import { frozenPartHashes, inspectInvoiceWorkbook, sha256 } from "./invoice-openxml.js";

export const INVOICE_MASTER_CHECKSUM_KEY = "invoice_master_sha256";

export function projectRoot() {
  return path.resolve(env.backendRoot, "..");
}

export function sourceInvoicePath() {
  return defaultSourceInvoicePath();
}

export function getMasterDir() {
  return masterDir(env.STORAGE_ROOT);
}

export function getMasterPath() {
  return masterPath(env.STORAGE_ROOT);
}

export function getMasterManifestPath() {
  return masterManifestPath(env.STORAGE_ROOT);
}

export function isMasterPath(targetPath) {
  return isSamePath(targetPath, getMasterPath());
}

export function assertNotMasterPath(targetPath) {
  if (isMasterPath(targetPath)) {
    throw new AppError("MASTER_READONLY", "MASTER 파일에는 쓸 수 없습니다.", 500);
  }
}

export function readMasterRawBytes() {
  const masterPath = getMasterPath();
  if (!fs.existsSync(masterPath)) {
    throw new AppError("MASTER_MISSING", "거래명세서 MASTER 파일이 없습니다.", 500);
  }
  return Buffer.from(fs.readFileSync(masterPath));
}

export function createMasterOutputCopy(masterBytes = readMasterRawBytes()) {
  return Buffer.from(masterBytes);
}

export async function writeGeneratedInvoice(targetPath, bytes) {
  assertNotMasterPath(targetPath);
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.writeFile(targetPath, bytes);
}

export function readMasterManifest() {
  const manifestPath = getMasterManifestPath();
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export function computeMasterChecksum(bytes = readMasterRawBytes()) {
  return sha256(bytes);
}

export function inspectMasterStatus() {
  const masterPath = getMasterPath();
  const manifest = readMasterManifest();
  if (!fs.existsSync(masterPath)) {
    return {
      ok: false,
      code: "MASTER_MISSING",
      message: "거래명세서 MASTER 파일이 없습니다.",
      path: masterPath,
      expectedSha256: manifest?.sha256 ?? null,
    };
  }

  const bytes = readMasterRawBytes();
  const actualSha256 = sha256(bytes);
  const expectedSha256 = manifest?.sha256 ?? null;
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    return {
      ok: false,
      code: "MASTER_CHECKSUM_MISMATCH",
      message: "거래명세서 MASTER checksum이 기록값과 다릅니다. MASTER는 자동 수정하지 않습니다.",
      path: masterPath,
      expectedSha256,
      actualSha256,
    };
  }

  return {
    ok: true,
    code: "MASTER_OK",
    message: "거래명세서 MASTER 읽기 전용 확인",
    path: masterPath,
    sha256: actualSha256,
    bytes: bytes.length,
  };
}

export function warnInvoiceMasterStatus() {
  const status = inspectMasterStatus();
  if (status.ok) {
    logger.info(`Invoice MASTER ok sha256=${status.sha256}`);
    return status;
  }
  logger.warn(`${status.code}: ${status.message}`);
  return status;
}

export async function syncInvoiceMasterChecksum() {
  const status = inspectMasterStatus();
  if (!status.ok || !status.sha256) {
    return status;
  }
  await pool.query(
    `
      INSERT INTO app_metadata (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [INVOICE_MASTER_CHECKSUM_KEY, status.sha256],
  );
  return status;
}

export async function readStoredMasterChecksum() {
  const { rows } = await pool.query("SELECT value FROM app_metadata WHERE key = $1", [
    INVOICE_MASTER_CHECKSUM_KEY,
  ]);
  return rows[0]?.value ?? null;
}

export async function assertFrozenPartsUnchanged(masterBytes, sourceBytes) {
  const masterHashes = await frozenPartHashes(masterBytes);
  const sourceHashes = await frozenPartHashes(sourceBytes);
  const changed = [];
  for (const part of FROZEN_PARTS) {
    if (masterHashes[part] !== sourceHashes[part]) {
      changed.push(part);
    }
  }
  if (changed.length > 0) {
    throw new AppError(
      "MASTER_FROZEN_PART_CHANGED",
      `MASTER 금지 파트가 원본과 다릅니다: ${changed.join(", ")}`,
      500,
      { changed },
    );
  }
  return masterHashes;
}

export async function inspectMasterWorkbook() {
  return inspectInvoiceWorkbook(readMasterRawBytes());
}

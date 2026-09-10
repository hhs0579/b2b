import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "./app-error.js";

export function ordersUploadDir() {
  return path.join(env.STORAGE_ROOT, "uploads", "orders");
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function decodeOriginalFileName(name) {
  const raw = String(name || "upload.xlsx");
  const base = path.basename(raw).replace(/[/\\]/g, "");
  if (!base || base === "." || base === "..") {
    return "upload.xlsx";
  }
  const decoded = Buffer.from(base, "latin1").toString("utf8");
  if (/[가-힣]/.test(decoded) && !/[가-힣]/.test(base)) {
    return decoded;
  }
  return base;
}

export function extensionOf(fileName) {
  return path.extname(fileName).toLowerCase();
}

export function assertAllowedExcelName(fileName) {
  const ext = extensionOf(fileName);
  if (ext !== ".xls" && ext !== ".xlsx") {
    throw new AppError("INVALID_FILE_TYPE", "xls 또는 xlsx 파일만 업로드할 수 있습니다.", 400);
  }
  return ext;
}

export function newStoredFileName(ext) {
  return `${randomUUID()}${ext}`;
}

export function resolveStoredFilePath(storedFileName) {
  if (!/^[0-9a-f-]{36}\.(xls|xlsx)$/i.test(storedFileName)) {
    throw new AppError("INVALID_STORED_FILE", "저장된 파일명을 확인할 수 없습니다.", 500);
  }
  const dir = path.resolve(ordersUploadDir());
  const abs = path.resolve(dir, storedFileName);
  const rel = path.relative(dir, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AppError("INVALID_STORED_FILE", "저장된 파일 경로가 올바르지 않습니다.", 500);
  }
  return abs;
}

export async function saveOrderUploadBuffer(buffer, ext) {
  const storedFileName = newStoredFileName(ext);
  const storedFilePath = resolveStoredFilePath(storedFileName);
  await fs.mkdir(ordersUploadDir(), { recursive: true });
  await fs.writeFile(storedFilePath, buffer);
  const written = await fs.readFile(storedFilePath);
  if (sha256(written) !== sha256(buffer)) {
    await fs.unlink(storedFilePath).catch(() => {});
    throw new AppError("FILE_SAVE_FAILED", "업로드 파일 저장에 실패했습니다.", 500);
  }
  return { storedFileName, storedFilePath };
}

export async function deleteStoredOrderFile(storedFileName) {
  try {
    await fs.unlink(resolveStoredFilePath(storedFileName));
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "INVALID_STORED_FILE") {
      throw err;
    }
  }
}

export async function readStoredOrderFile(storedFileName) {
  return fs.readFile(resolveStoredFilePath(storedFileName));
}

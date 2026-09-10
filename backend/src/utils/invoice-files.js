import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "./app-error.js";
import { sha256 } from "../domain/invoice-openxml.js";

export function invoicesDir() {
  return path.join(env.STORAGE_ROOT, "generated", "invoices");
}

export function invoicesInvalidDir() {
  return path.join(invoicesDir(), "invalid");
}

export function newInvoiceStoredName() {
  return `${randomUUID()}.xlsx`;
}

export function resolveInvoiceStoredPath(storedFileName) {
  if (!/^[0-9a-f-]{36}\.xlsx$/i.test(storedFileName)) {
    throw new AppError("INVALID_STORED_FILE", "저장된 거래명세서 파일명을 확인할 수 없습니다.", 500);
  }
  const dir = path.resolve(invoicesDir());
  const abs = path.resolve(dir, storedFileName);
  const rel = path.relative(dir, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw new AppError("INVALID_STORED_FILE", "저장된 파일 경로가 올바르지 않습니다.", 500);
  }
  return abs;
}

export async function writeInvoiceOutput(storedFileName, bytes) {
  const dest = resolveInvoiceStoredPath(storedFileName);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes);
  const written = await fs.readFile(dest);
  if (sha256(written) !== sha256(bytes)) {
    await fs.unlink(dest).catch(() => {});
    throw new AppError("FILE_SAVE_FAILED", "거래명세서 저장에 실패했습니다.", 500);
  }
  return dest;
}

export async function isolateInvalidInvoice(storedFileName, bytes) {
  const dest = path.join(invoicesInvalidDir(), storedFileName);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes);
  return dest;
}

export async function deleteInvoiceOutput(storedFileName) {
  try {
    await fs.unlink(resolveInvoiceStoredPath(storedFileName));
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "INVALID_STORED_FILE") {
      throw err;
    }
  }
}

export async function readInvoiceOutput(storedFileName) {
  return fs.readFile(resolveInvoiceStoredPath(storedFileName));
}

export function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replaceAll('"', "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

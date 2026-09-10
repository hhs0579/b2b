import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MASTER_FILE_NAME,
  MASTER_MANIFEST_NAME,
  SOURCE_INVOICE_FILE_NAME,
} from "./invoice-template-map.js";

const domainDir = path.dirname(fileURLToPath(import.meta.url));

export const BACKEND_ROOT = path.resolve(domainDir, "../..");
export const PROJECT_ROOT = path.resolve(BACKEND_ROOT, "..");
export const DEFAULT_STORAGE_ROOT = path.resolve(BACKEND_ROOT, "../storage");

export function sourceInvoicePath() {
  return path.join(PROJECT_ROOT, SOURCE_INVOICE_FILE_NAME);
}

export function masterDir(storageRoot = DEFAULT_STORAGE_ROOT) {
  return path.join(storageRoot, "masters");
}

export function masterPath(storageRoot = DEFAULT_STORAGE_ROOT) {
  return path.join(masterDir(storageRoot), MASTER_FILE_NAME);
}

export function masterManifestPath(storageRoot = DEFAULT_STORAGE_ROOT) {
  return path.join(masterDir(storageRoot), MASTER_MANIFEST_NAME);
}

export function isSamePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

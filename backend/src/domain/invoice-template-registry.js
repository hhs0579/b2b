import path from "node:path";
import { AppError } from "../utils/app-error.js";
import {
  FROZEN_PARTS,
  MASTER_FILE_NAME,
  MASTER_MANIFEST_NAME,
  SOURCE_INVOICE_FILE_NAME,
  STAMP_DRAWING_PART,
  STAMP_DRAWING_RELS_PART,
  STAMP_IMAGE_SHA256,
  STAMP_MEDIA_PART,
} from "./invoice-template-map.js";
import { DEFAULT_STORAGE_ROOT, PROJECT_ROOT, masterDir } from "./invoice-master-paths.js";

export const INVOICE_TEMPLATE_CODES = Object.freeze({
  ESSER: "ESSER",
  BESTHEIM: "BESTHEIM",
});

export const INVOICE_TEMPLATES = Object.freeze({
  ESSER: Object.freeze({
    code: "ESSER",
    supplierProfileCode: "ESSER",
    displayName: "에쎄르",
    masterFileName: MASTER_FILE_NAME,
    manifestFileName: MASTER_MANIFEST_NAME,
    sourceFileName: SOURCE_INVOICE_FILE_NAME,
    stampFileName: "stamps/esser_stamp.jpeg",
    stampMediaPart: STAMP_MEDIA_PART,
    stampSha256: STAMP_IMAGE_SHA256,
    stampEmbedId: "rId1",
    frozenParts: FROZEN_PARTS,
    metadataChecksumKey: "invoice_master_sha256",
  }),
  BESTHEIM: Object.freeze({
    code: "BESTHEIM",
    supplierProfileCode: "BESTHEIM",
    displayName: "베스트하임",
    masterFileName: "invoice_BESTHEIM_MASTER.xlsx",
    manifestFileName: "invoice_BESTHEIM_MASTER.manifest.json",
    sourceFileName: "260911_제이와이컴퍼니_거래명세서(베스트하임).xlsx",
    stampSourceFileName: "베스트하임인감.png",
    stampFileName: "stamps/bestheim_stamp.png",
    stampMediaPart: "xl/media/image2.png",
    stampSha256: "d61cb0f12deb3d4a4f246c00608951d3b1b4879dbbe3eecc34158b2f6e59626e",
    stampEmbedId: "rId2",
    frozenParts: Object.freeze([
      "xl/styles.xml",
      "xl/theme/theme1.xml",
      STAMP_DRAWING_PART,
      STAMP_DRAWING_RELS_PART,
      "xl/media/image1.jpeg",
      "xl/media/image2.png",
      "xl/workbook.xml",
      "xl/worksheets/_rels/sheet1.xml.rels",
    ]),
    metadataChecksumKey: "invoice_bestheim_master_sha256",
  }),
});

export function getInvoiceTemplate(code) {
  const template = INVOICE_TEMPLATES[String(code || "").toUpperCase()];
  if (!template) {
    throw new AppError("INVOICE_TEMPLATE_NOT_FOUND", "거래명세서 공급자 템플릿을 찾을 수 없습니다.", 400);
  }
  return template;
}

export function listInvoiceTemplates() {
  return Object.values(INVOICE_TEMPLATES);
}

export function templateMasterPath(template, storageRoot = DEFAULT_STORAGE_ROOT) {
  return path.join(masterDir(storageRoot), template.masterFileName);
}

export function templateManifestPath(template, storageRoot = DEFAULT_STORAGE_ROOT) {
  return path.join(masterDir(storageRoot), template.manifestFileName);
}

export function templateSourcePath(template) {
  return path.join(PROJECT_ROOT, template.sourceFileName);
}

export function templateStampPath(template, storageRoot = DEFAULT_STORAGE_ROOT) {
  return path.join(masterDir(storageRoot), template.stampFileName);
}

export function isAnyMasterPath(targetPath, storageRoot = DEFAULT_STORAGE_ROOT) {
  const resolved = path.resolve(targetPath);
  return listInvoiceTemplates().some((template) => path.resolve(templateMasterPath(template, storageRoot)) === resolved);
}

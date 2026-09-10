import fs from "node:fs";
import path from "node:path";
import { cleanInvoiceWorkbook } from "../src/domain/invoice-master-clean.js";
import {
  masterDir,
  masterManifestPath,
  masterPath,
  sourceInvoicePath,
} from "../src/domain/invoice-master-paths.js";
import { inspectInvoiceWorkbook, sha256 } from "../src/domain/invoice-openxml.js";
import { FROZEN_PARTS, MASTER_FILE_NAME } from "../src/domain/invoice-template-map.js";

const force = process.argv.includes("--force");

async function main() {
  const sourcePath = sourceInvoicePath();
  const destPath = masterPath();
  const destDir = masterDir();
  const manifestPath = masterManifestPath();

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`원본 거래명세서 없음: ${sourcePath}`);
  }
  if (fs.existsSync(destPath) && !force) {
    throw new Error(`MASTER가 이미 있습니다. 덮어쓰지 않습니다: ${destPath}`);
  }

  const sourceBytes = fs.readFileSync(sourcePath);
  const sourceBefore = sha256(sourceBytes);
  const masterBytes = await cleanInvoiceWorkbook(sourceBytes);
  const sourceAfter = sha256(fs.readFileSync(sourcePath));
  if (sourceBefore !== sourceAfter) {
    throw new Error("원본 거래명세서 checksum이 변경되었습니다. 원본은 수정하면 안 됩니다.");
  }

  const sourceInspect = await inspectInvoiceWorkbook(sourceBytes);
  const masterInspect = await inspectInvoiceWorkbook(masterBytes);
  const changedFrozen = FROZEN_PARTS.filter(
    (part) => sourceInspect.partHashes[part] !== masterInspect.partHashes[part],
  );
  if (changedFrozen.length > 0) {
    throw new Error(`금지 파트가 변경됨: ${changedFrozen.join(", ")}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(destPath, masterBytes);
  const written = fs.readFileSync(destPath);
  const fileSha256 = sha256(written);
  if (fileSha256 !== sha256(masterBytes)) {
    fs.unlinkSync(destPath);
    throw new Error("MASTER 저장 후 checksum이 일치하지 않습니다.");
  }

  const manifest = {
    file: MASTER_FILE_NAME,
    sha256: fileSha256,
    bytes: written.length,
    sheetName: masterInspect.sheetName,
    printArea: masterInspect.printArea,
    mergeCount: masterInspect.merges.count,
    image1JpegSha256: masterInspect.media.sha256,
    frozenPartSha256: masterInspect.partHashes,
    createdBy: "openxml-cell-clear",
    sourceFile: path.basename(sourcePath),
    sourceSha256: sourceBefore,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`MASTER written: ${destPath}`);
  console.log(`sha256: ${fileSha256}`);
  console.log(`image1.jpeg: ${masterInspect.media.sha256}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

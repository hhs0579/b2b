import fs from "node:fs";
import path from "node:path";
import { cleanInvoiceWorkbook } from "../src/domain/invoice-master-clean.js";
import { inspectInvoiceWorkbook, sha256 } from "../src/domain/invoice-openxml.js";
import { SAMPLE_TEXT_MARKERS } from "../src/domain/invoice-template-map.js";
import {
  INVOICE_TEMPLATES,
  templateManifestPath,
  templateMasterPath,
  templateSourcePath,
  templateStampPath,
} from "../src/domain/invoice-template-registry.js";
import { masterDir, masterPath } from "../src/domain/invoice-master-paths.js";

const force = process.argv.includes("--force");
const BESTHEIM_SAMPLE_MARKERS = [
  ...SAMPLE_TEXT_MARKERS,
  "영양맛밤",
  "택배비-4,000원",
  "4,000원 × 15",
  "담당자 : 제이와이컴퍼니",
];

async function main() {
  const template = INVOICE_TEMPLATES.BESTHEIM;
  const sourcePath = templateSourcePath(template);
  const destPath = templateMasterPath(template);
  const destDir = masterDir();
  const stampDest = templateStampPath(template);
  const stampSource = path.join(path.dirname(sourcePath), template.stampSourceFileName);
  const esserStampDest = path.join(destDir, INVOICE_TEMPLATES.ESSER.stampFileName);
  const esserMaster = masterPath();

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`베스트하임 원본 없음: ${sourcePath}`);
  }
  if (!fs.existsSync(stampSource)) {
    throw new Error(`베스트하임 인감 없음: ${stampSource}`);
  }
  if (fs.existsSync(destPath) && !force) {
    throw new Error(`BESTHEIM MASTER가 이미 있습니다. 덮어쓰지 않습니다: ${destPath}`);
  }

  const sourceBytes = fs.readFileSync(sourcePath);
  const sourceBefore = sha256(sourceBytes);
  const stampBytes = fs.readFileSync(stampSource);
  if (sha256(stampBytes) !== template.stampSha256) {
    throw new Error("베스트하임인감.png checksum이 registry 기록과 다릅니다. 원본을 재압축하지 마세요.");
  }

  const masterBytes = await cleanInvoiceWorkbook(sourceBytes, {
    sampleMarkers: BESTHEIM_SAMPLE_MARKERS,
    replaceMedia: { [template.stampMediaPart]: stampBytes },
    rewriteDrawingEmbeds: template.stampEmbedId,
  });
  const sourceAfter = sha256(fs.readFileSync(sourcePath));
  if (sourceBefore !== sourceAfter) {
    throw new Error("베스트하임 원본 checksum이 변경되었습니다. 원본은 수정하면 안 됩니다.");
  }

  const masterInspect = await inspectInvoiceWorkbook(masterBytes, {
    stampMediaPart: template.stampMediaPart,
    frozenParts: template.frozenParts,
  });
  if (masterInspect.media.sha256 !== template.stampSha256) {
    throw new Error("MASTER 도장 hash가 원본 PNG와 다릅니다.");
  }
  if (!masterInspect.drawing?.embeds.every((embed) => embed === template.stampEmbedId)) {
    throw new Error("BESTHEIM MASTER 도장 embed가 원본 PNG를 가리키지 않습니다.");
  }

  fs.mkdirSync(path.dirname(stampDest), { recursive: true });
  fs.writeFileSync(stampDest, stampBytes);
  if (sha256(fs.readFileSync(stampDest)) !== template.stampSha256) {
    throw new Error("베스트하임 도장 복사 후 checksum이 변경되었습니다.");
  }

  if (fs.existsSync(esserMaster)) {
    const { default: JSZip } = await import("jszip");
    const esserZip = await JSZip.loadAsync(fs.readFileSync(esserMaster));
    const esserStamp = await esserZip.file(INVOICE_TEMPLATES.ESSER.stampMediaPart).async("nodebuffer");
    fs.mkdirSync(path.dirname(esserStampDest), { recursive: true });
    if (!fs.existsSync(esserStampDest)) {
      fs.writeFileSync(esserStampDest, esserStamp);
    }
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(destPath, masterBytes);
  const written = fs.readFileSync(destPath);
  const fileSha256 = sha256(written);
  if (fileSha256 !== sha256(masterBytes)) {
    fs.unlinkSync(destPath);
    throw new Error("BESTHEIM MASTER 저장 후 checksum이 일치하지 않습니다.");
  }

  const manifest = {
    file: template.masterFileName,
    templateCode: template.code,
    sha256: fileSha256,
    bytes: written.length,
    sheetName: masterInspect.sheetName,
    printArea: masterInspect.printArea,
    mergeCount: masterInspect.merges.count,
    stampMediaPart: template.stampMediaPart,
    stampSha256: masterInspect.media.sha256,
    frozenPartSha256: masterInspect.partHashes,
    createdBy: "openxml-cell-clear+original-png-stamp",
    sourceFile: path.basename(sourcePath),
    sourceSha256: sourceBefore,
    stampSourceFile: path.basename(stampSource),
    stampSourceSha256: sha256(stampBytes),
  };
  fs.writeFileSync(templateManifestPath(template), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`MASTER written: ${destPath}`);
  console.log(`sha256: ${fileSha256}`);
  console.log(`stamp: ${masterInspect.media.sha256}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

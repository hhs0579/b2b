import {
  CELLS,
  FROZEN_PARTS,
  SAMPLE_TEXT_MARKERS,
  formulaCellsForLayout,
  invoiceSheetLayout,
  writableCellsForLayout,
} from "./invoice-template-map.js";
import { INVOICE_TEMPLATES } from "./invoice-template-registry.js";
import {
  inspectInvoiceWorkbook,
  loadOpenXmlZip,
  partSha256,
  readZipText,
  sha256,
} from "./invoice-openxml.js";
import { toIsoDate } from "./dates.js";

const ALLOWED_PART_DIFFS = new Set([
  "xl/worksheets/sheet1.xml",
  "xl/sharedStrings.xml",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "[Content_Types].xml",
  "xl/calcChain.xml",
]);

export function sanitizeInvoiceFileName(name) {
  return String(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "") || "매출처";
}

export function invoiceDownloadFileName(orderDate, clientName, version, supplierName) {
  const iso = toIsoDate(orderDate) || "";
  const yymmdd = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;
  const supplier = supplierName ? `_${sanitizeInvoiceFileName(supplierName)}` : "";
  const base = `${yymmdd}_${sanitizeInvoiceFileName(clientName)}_거래명세서${supplier}`;
  return version > 1 ? `${base}_v${version}.xlsx` : `${base}.xlsx`;
}

export function collectGeneratedDiffs(masterInspect, generatedInspect, layout = invoiceSheetLayout(0)) {
  const diffs = [];
  const writable = writableCellsForLayout(layout);
  for (const ref of writable) {
    const before = masterInspect.cells[ref]?.value ?? "";
    const after = generatedInspect.cells[ref]?.value ?? "";
    if (String(before) !== String(after)) {
      diffs.push({ kind: "cell", ref, from: before, to: after });
    }
  }
  for (const ref of Object.keys(formulaCellsForLayout(layout))) {
    const before = masterInspect.cells[ref]?.rawValue ?? "";
    const after = generatedInspect.cells[ref]?.rawValue ?? "";
    if (String(before) !== String(after)) {
      diffs.push({ kind: "formula-cached", ref, from: before, to: after });
    }
  }
  const masterSst = masterInspect.sharedStrings;
  const generatedSst = generatedInspect.sharedStrings;
  if (generatedSst.length < masterSst.length) {
    diffs.push({ kind: "sharedStrings", message: "sharedStrings 길이가 MASTER보다 짧습니다." });
  } else {
    for (let i = 0; i < masterSst.length; i += 1) {
      if (masterSst[i] !== generatedSst[i]) {
        diffs.push({ kind: "sharedStrings", message: `기존 sst index ${i} 재배열/변경` });
      }
    }
    if (generatedSst.length > masterSst.length) {
      diffs.push({
        kind: "sharedStrings-append",
        added: generatedSst.slice(masterSst.length),
      });
    }
  }
  return diffs;
}

export async function listPartHashes(buffer) {
  const zip = await loadOpenXmlZip(buffer);
  const hashes = {};
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) {
      continue;
    }
    hashes[name] = await partSha256(zip, name);
  }
  return hashes;
}

export async function verifyGeneratedInvoice(masterBytes, generatedBytes, fillPlan, template = INVOICE_TEMPLATES.ESSER) {
  const errors = [];
  const layout = fillPlan.layout || invoiceSheetLayout(0);
  const writable = writableCellsForLayout(layout);
  const expectedFormulas = formulaCellsForLayout(layout);
  const inspectOptions = { stampMediaPart: template.stampMediaPart, frozenParts: template.frozenParts };
  const master = await inspectInvoiceWorkbook(masterBytes, inspectOptions);
  const generated = await inspectInvoiceWorkbook(generatedBytes, inspectOptions);
  const masterParts = await listPartHashes(masterBytes);
  const generatedParts = await listPartHashes(generatedBytes);
  const allowedDiffs = new Set(ALLOWED_PART_DIFFS);
  const frozenParts = template.frozenParts || FROZEN_PARTS;

  for (const part of Object.keys({ ...masterParts, ...generatedParts })) {
    if (allowedDiffs.has(part)) {
      continue;
    }
    if (masterParts[part] !== generatedParts[part]) {
      errors.push(`예상치 못한 part diff: ${part}`);
    }
  }

  for (const part of frozenParts) {
    if (part === "xl/workbook.xml") {
      continue;
    }
    if (master.partHashes[part] !== generated.partHashes[part]) {
      errors.push(`금지 파트 변경: ${part}`);
    }
  }

  if (generated.parts.includes("xl/calcChain.xml")) {
    errors.push("생성본에 calcChain.xml이 남아 있습니다.");
  }

  const generatedZip = await loadOpenXmlZip(generatedBytes);
  const generatedRels = await readZipText(generatedZip, "xl/_rels/workbook.xml.rels");
  const generatedTypes = await readZipText(generatedZip, "[Content_Types].xml");
  if (/calcChain/i.test(generatedRels || "") || /calcChain/i.test(generatedTypes || "")) {
    errors.push("calcChain 참조가 생성본 관계/Content_Types에 남아 있습니다.");
  }

  if (!layout.expanded) {
    if (master.merges.count !== generated.merges.count || master.merges.refs.join() !== generated.merges.refs.join()) {
      errors.push("worksheet 구조 변경: mergeCells");
    }
    if (
      master.pageSetup.paperSize !== generated.pageSetup.paperSize ||
      master.pageSetup.scale !== generated.pageSetup.scale ||
      master.pageSetup.orientation !== generated.pageSetup.orientation
    ) {
      errors.push("worksheet 구조 변경: pageSetup");
    }
  }
  if (JSON.stringify(master.columns) !== JSON.stringify(generated.columns)) {
    errors.push("worksheet 구조 변경: cols");
  }
  const marginKeys = ["left", "right", "top", "bottom", "header", "footer"];
  if (marginKeys.some((key) => master.pageMargins[key] !== generated.pageMargins[key])) {
    errors.push("worksheet 구조 변경: pageMargins");
  }
  if (
    master.printOptions.horizontalCentered !== generated.printOptions.horizontalCentered ||
    master.printOptions.gridLinesSet !== generated.printOptions.gridLinesSet
  ) {
    errors.push("worksheet 구조 변경: printOptions");
  }

  if (generated.sheetName !== master.sheetName) {
    errors.push("Sheet 이름 변경");
  }
  if (generated.printArea !== layout.printArea) {
    errors.push(`Print Area 불일치: ${generated.printArea} ≠ ${layout.printArea}`);
  }
  if (generated.media.sha256 !== master.media.sha256) {
    errors.push("image1.jpeg checksum 변경");
  }

  for (const [ref, expected] of Object.entries(expectedFormulas)) {
    const actual = generated.formulas[ref];
    if (!actual || actual.text !== expected.text) {
      errors.push(`수식 손상: ${ref}`);
      continue;
    }
    if (!layout.expanded && expected.shared != null && Boolean(actual.shared) !== Boolean(expected.shared)) {
      errors.push(`수식 손상: ${ref}`);
    }
  }

  for (const [ref, spec] of Object.entries(fillPlan.cells)) {
    const actual = generated.cells[ref]?.value;
    if (String(actual ?? "") !== String(spec.value)) {
      errors.push(`입력 셀 불일치 ${ref}: ${actual} ≠ ${spec.value}`);
    }
  }
  for (const ref of writable) {
    if (fillPlan.cells[ref]) {
      continue;
    }
    const actual = generated.cells[ref]?.value;
    if (actual != null && actual !== "") {
      errors.push(`빈 행/셀에 값이 남아 있음: ${ref}=${actual}`);
    }
  }
  for (const [ref, value] of Object.entries(fillPlan.formulaCached)) {
    if (String(generated.cells[ref]?.rawValue) !== String(value)) {
      errors.push(`cached 수식값 불일치 ${ref}: ${generated.cells[ref]?.rawValue} ≠ ${value}`);
    }
  }

  const writtenRefs = new Set(Object.keys(fillPlan.cells));
  for (const cell of Object.values(generated.cells)) {
    if (writtenRefs.has(cell.ref)) {
      continue;
    }
    const text = String(cell.value ?? "");
    if (SAMPLE_TEXT_MARKERS.some((marker) => text.includes(marker))) {
      errors.push(`샘플 문구 잔존: ${cell.ref}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    diffs: collectGeneratedDiffs(master, generated, layout),
    inspect: generated,
    fileSha256: sha256(generatedBytes),
  };
}

export function expectedCachedAmount(qty, price) {
  return qty * price;
}

export { CELLS };

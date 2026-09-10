import JSZip from "jszip";
import { parseSheetCells, parseSheetStructureTags } from "./invoice-openxml.js";
import {
  FORMULA_CELLS,
  INVOICE_MERGE_COUNT,
  SAMPLE_SST_INDEXES,
  WRITABLE_CELLS,
} from "./invoice-template-map.js";

function cellPattern(ref) {
  return new RegExp(`<c r="${ref}"([^>]*?)\\/>|<c r="${ref}"([^>]*?)>([\\s\\S]*?)<\\/c>`);
}

function stripTypeAttr(attrs) {
  return attrs.replace(/\s+t="s"/, "");
}

function replaceCellXml(sheetXml, ref, replacer) {
  const pattern = cellPattern(ref);
  if (!pattern.test(sheetXml)) {
    return sheetXml;
  }
  return sheetXml.replace(pattern, (match, selfAttrs, openAttrs, inner) =>
    replacer({
      match,
      attrs: selfAttrs ?? openAttrs ?? "",
      inner: inner ?? "",
      selfClosing: selfAttrs != null,
    }),
  );
}

export function clearWritableCellXml(sheetXml, ref) {
  return replaceCellXml(sheetXml, ref, ({ attrs }) => `<c r="${ref}"${stripTypeAttr(attrs)}/>`);
}

export function zeroFormulaCachedValue(sheetXml, ref) {
  return replaceCellXml(sheetXml, ref, ({ match, attrs, inner, selfClosing }) => {
    if (selfClosing || !/<f\b/.test(inner)) {
      return match;
    }
    const nextInner = /<v>/.test(inner)
      ? inner.replace(/<v>[\s\S]*?<\/v>/, "<v>0</v>")
      : `${inner}<v>0</v>`;
    return `<c r="${ref}"${attrs}>${nextInner}</c>`;
  });
}

export function clearSampleSharedStrings(sstXml) {
  const items = sstXml.match(/<si>[\s\S]*?<\/si>/g);
  if (!items) {
    return sstXml;
  }
  const next = items.map((item, index) =>
    SAMPLE_SST_INDEXES.includes(index) ? "<si><t></t></si>" : item,
  );
  let cursor = 0;
  return sstXml.replace(/<si>[\s\S]*?<\/si>/g, () => next[cursor++]);
}

export function assertPatchedSheetIntact(originalXml, patchedXml) {
  const before = parseSheetStructureTags(originalXml);
  const after = parseSheetStructureTags(patchedXml);
  for (const key of ["mergeCells", "cols", "pageMargins", "pageSetup", "printOptions"]) {
    if (before[key] !== after[key]) {
      throw new Error(`클린 패치가 worksheet ${key} 를 변경했습니다.`);
    }
  }
  const mergeCount = Number(after.mergeCells?.match(/count="(\d+)"/)?.[1] || 0);
  if (mergeCount !== INVOICE_MERGE_COUNT) {
    throw new Error(`클린 패치 후 병합셀 ${mergeCount}개`);
  }
  const cells = parseSheetCells(patchedXml);
  for (const ref of Object.keys(FORMULA_CELLS)) {
    const expected = FORMULA_CELLS[ref];
    const actual = cells[ref]?.formula;
    if (!actual || actual.text !== expected.text) {
      throw new Error(`클린 패치 후 수식 손상: ${ref}`);
    }
  }
}

export function fixApprovedG17Formula(sheetXml) {
  return replaceCellXml(sheetXml, "G17", ({ match, attrs, inner, selfClosing }) => {
    if (selfClosing || !/<f\b/.test(inner)) {
      return match;
    }
    const nextInner = inner.replace(">SUM(G12:H16)</f>", ">SUM(G10:H16)</f>");
    return `<c r="G17"${attrs}>${nextInner}</c>`;
  });
}

export function patchInvoiceSheetXml(sheetXml) {
  let next = sheetXml;
  for (const ref of WRITABLE_CELLS) {
    next = clearWritableCellXml(next, ref);
  }
  for (const ref of Object.keys(FORMULA_CELLS)) {
    next = zeroFormulaCachedValue(next, ref);
  }
  next = fixApprovedG17Formula(next);
  assertPatchedSheetIntact(sheetXml, next);
  return next;
}

export async function cleanInvoiceWorkbook(sourceBuffer) {
  const zip = await JSZip.loadAsync(sourceBuffer);
  const sheetFile = zip.file("xl/worksheets/sheet1.xml");
  const sstFile = zip.file("xl/sharedStrings.xml");
  if (!sheetFile || !sstFile) {
    throw new Error("거래명세서 OpenXML에 sheet1 또는 sharedStrings가 없습니다.");
  }

  const sheetXml = await sheetFile.async("string");
  const sstXml = await sstFile.async("string");
  zip.file("xl/worksheets/sheet1.xml", patchInvoiceSheetXml(sheetXml));
  zip.file("xl/sharedStrings.xml", clearSampleSharedStrings(sstXml));

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

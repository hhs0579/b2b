import JSZip from "jszip";
import { createHash } from "node:crypto";
import {
  FROZEN_PARTS,
  STAMP_DRAWING_PART,
  STAMP_DRAWING_RELS_PART,
  STAMP_MEDIA_PART,
} from "./invoice-template-map.js";

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function loadOpenXmlZip(buffer) {
  return JSZip.loadAsync(buffer);
}

export async function readZipText(zip, partName) {
  const file = zip.file(partName);
  if (!file) {
    return null;
  }
  return file.async("string");
}

export async function readZipBuffer(zip, partName) {
  const file = zip.file(partName);
  if (!file) {
    return null;
  }
  return file.async("nodebuffer");
}

export async function partSha256(zip, partName) {
  const bytes = await readZipBuffer(zip, partName);
  if (!bytes) {
    return null;
  }
  return sha256(bytes);
}

export async function frozenPartHashes(buffer) {
  const zip = await loadOpenXmlZip(buffer);
  const hashes = {};
  for (const part of FROZEN_PARTS) {
    hashes[part] = await partSha256(zip, part);
  }
  return hashes;
}

export function parseSharedStrings(sstXml) {
  if (!sstXml) {
    return [];
  }
  return [...sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    const texts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
    return texts.map((item) => decodeXmlText(item[1])).join("");
  });
}

function decodeXmlText(value) {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function attr(fragment, name) {
  const match = fragment.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : null;
}

export function parseWorkbookMeta(workbookXml) {
  const sheets = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)].map((match) => ({
    name: attr(match[1], "name"),
    sheetId: attr(match[1], "sheetId"),
    id: attr(match[1], "r:id"),
  }));
  const definedNames = [...workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)].map(
    (match) => ({
      name: attr(match[1], "name"),
      localSheetId: attr(match[1], "localSheetId"),
      value: match[2],
    }),
  );
  const printArea = definedNames.find((item) => item.name === "_xlnm.Print_Area")?.value ?? null;
  return { sheets, definedNames, printArea };
}

export function parseMergeRefs(sheetXml) {
  const count = Number(attr(sheetXml.match(/<mergeCells\b([^>]*)>/)?.[1] ?? "", "count") || 0);
  const refs = [...sheetXml.matchAll(/<mergeCell\b([^>]*)\/?>/g)]
    .map((match) => attr(match[1], "ref"))
    .filter(Boolean);
  return { count, refs: [...refs].sort() };
}

export function parseRowHeights(sheetXml) {
  const heights = {};
  for (const match of sheetXml.matchAll(/<row\b([^>]*)\/?>/g)) {
    const row = Number(attr(match[1], "r"));
    if (Number.isInteger(row)) {
      heights[row] = attr(match[1], "ht");
    }
  }
  return heights;
}

export function parseColumnWidths(sheetXml) {
  const cols = [];
  const block = sheetXml.match(/<cols>([\s\S]*?)<\/cols>/)?.[1] ?? "";
  for (const match of block.matchAll(/<col\b([^>]*)\/?>/g)) {
    cols.push({
      min: attr(match[1], "min"),
      max: attr(match[1], "max"),
      width: attr(match[1], "width"),
    });
  }
  return cols;
}

export function parsePageMargins(sheetXml) {
  const tag = sheetXml.match(/<pageMargins\b([^>]*)\/?>/)?.[1] ?? "";
  return {
    left: attr(tag, "left"),
    right: attr(tag, "right"),
    top: attr(tag, "top"),
    bottom: attr(tag, "bottom"),
    header: attr(tag, "header"),
    footer: attr(tag, "footer"),
    raw: sheetXml.match(/<pageMargins\b[^>]*\/?>/)?.[0] ?? null,
  };
}

export function parsePageSetup(sheetXml) {
  const tag = sheetXml.match(/<pageSetup\b([^>]*)\/?>/)?.[1] ?? "";
  return {
    paperSize: attr(tag, "paperSize"),
    scale: attr(tag, "scale"),
    orientation: attr(tag, "orientation"),
    raw: sheetXml.match(/<pageSetup\b[^>]*\/?>/)?.[0] ?? null,
  };
}

export function parsePrintOptions(sheetXml) {
  const tag = sheetXml.match(/<printOptions\b([^>]*)\/?>/)?.[1] ?? "";
  return {
    horizontalCentered: attr(tag, "horizontalCentered"),
    gridLinesSet: attr(tag, "gridLinesSet"),
    raw: sheetXml.match(/<printOptions\b[^>]*\/?>/)?.[0] ?? null,
  };
}

export function parseSheetStructureTags(sheetXml) {
  return {
    mergeCells: sheetXml.match(/<mergeCells\b[\s\S]*?<\/mergeCells>/)?.[0] ?? null,
    cols: sheetXml.match(/<cols>[\s\S]*?<\/cols>/)?.[0] ?? null,
    pageMargins: sheetXml.match(/<pageMargins\b[^>]*\/?>/)?.[0] ?? null,
    pageSetup: sheetXml.match(/<pageSetup\b[^>]*\/?>/)?.[0] ?? null,
    printOptions: sheetXml.match(/<printOptions\b[^>]*\/?>/)?.[0] ?? null,
  };
}

function parseFormula(inner) {
  const match = inner.match(/<f\b([^>]*)(?:\/>|>([\s\S]*?)<\/f>)/);
  if (!match) {
    return null;
  }
  return {
    text: match[2] ?? "",
    shared: attr(match[1], "t") === "shared",
    si: attr(match[1], "si"),
    ref: attr(match[1], "ref"),
  };
}

export function parseSheetCells(sheetXml, sharedStrings = []) {
  const cells = {};
  const re = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
  for (const match of sheetXml.matchAll(re)) {
    const selfClosing = match[1] != null;
    const attrs = selfClosing ? match[1] : match[2];
    const inner = selfClosing ? "" : match[3] ?? "";
    const ref = attr(attrs, "r");
    if (!ref) {
      continue;
    }
    const type = attr(attrs, "t");
    const rawValue = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? null;
    let value = rawValue;
    if (type === "s" && rawValue != null) {
      value = sharedStrings[Number(rawValue)] ?? rawValue;
    }
    cells[ref] = {
      ref,
      type,
      style: attr(attrs, "s"),
      rawValue,
      value,
      formula: parseFormula(inner),
    };
  }
  return cells;
}

export function sheetDataMaxRow(sheetXml) {
  const rows = [...sheetXml.matchAll(/<row\b([^>]*)\/?>/g)]
    .map((match) => Number(attr(match[1], "r")))
    .filter((row) => Number.isInteger(row));
  return rows.length === 0 ? 0 : Math.max(...rows);
}

export function parseDrawingPics(drawingXml) {
  const names = [...drawingXml.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
  const embeds = [...drawingXml.matchAll(/r:embed="([^"]+)"/g)].map((match) => match[1]);
  return { names, embeds, picCount: (drawingXml.match(/<xdr:pic>/g) || []).length };
}

export function parseRelationships(relsXml) {
  return [...relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((match) => ({
    id: attr(match[1], "Id"),
    type: attr(match[1], "Type"),
    target: attr(match[1], "Target"),
  }));
}

export async function inspectInvoiceWorkbook(buffer) {
  const zip = await loadOpenXmlZip(buffer);
  const names = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort();
  const workbookXml = await readZipText(zip, "xl/workbook.xml");
  const sheetXml = await readZipText(zip, "xl/worksheets/sheet1.xml");
  const sstXml = await readZipText(zip, "xl/sharedStrings.xml");
  const drawingXml = await readZipText(zip, STAMP_DRAWING_PART);
  const drawingRelsXml = await readZipText(zip, STAMP_DRAWING_RELS_PART);
  const sheetRelsXml = await readZipText(zip, "xl/worksheets/_rels/sheet1.xml.rels");
  const media = await readZipBuffer(zip, STAMP_MEDIA_PART);
  const sharedStrings = parseSharedStrings(sstXml);
  const workbook = parseWorkbookMeta(workbookXml);
  const cells = parseSheetCells(sheetXml, sharedStrings);
  const formulas = {};
  for (const [ref, cell] of Object.entries(cells)) {
    if (cell.formula) {
      formulas[ref] = cell.formula;
    }
  }

  return {
    parts: names,
    workbook,
    sheetName: workbook.sheets[0]?.name ?? null,
    printArea: workbook.printArea,
    merges: parseMergeRefs(sheetXml),
    rowHeights: parseRowHeights(sheetXml),
    columns: parseColumnWidths(sheetXml),
    pageMargins: parsePageMargins(sheetXml),
    pageSetup: parsePageSetup(sheetXml),
    printOptions: parsePrintOptions(sheetXml),
    structure: parseSheetStructureTags(sheetXml),
    cells,
    formulas,
    sharedStrings,
    maxRow: sheetDataMaxRow(sheetXml),
    drawing: drawingXml ? parseDrawingPics(drawingXml) : null,
    drawingRels: drawingRelsXml ? parseRelationships(drawingRelsXml) : [],
    sheetRels: sheetRelsXml ? parseRelationships(sheetRelsXml) : [],
    media: {
      path: STAMP_MEDIA_PART,
      exists: Boolean(media),
      sha256: media ? sha256(media) : null,
      bytes: media ? media.length : 0,
    },
    partHashes: await frozenPartHashes(buffer),
    fileSha256: sha256(buffer),
  };
}

export function cellDisplayValue(inspect, ref) {
  return inspect.cells[ref]?.value ?? "";
}

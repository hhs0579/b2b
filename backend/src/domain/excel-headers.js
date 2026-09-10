import XLSX from "xlsx";
import { AppError } from "../utils/app-error.js";

function isBlank(value) {
  return value == null || String(value).trim() === "";
}

function collapseWs(value) {
  return String(value ?? "")
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function usedRange(sheet) {
  const ref = sheet?.["!ref"];
  if (!ref) {
    return { startRow: 1, endRow: 0, startCol: 0, endCol: -1, ref: null };
  }
  const range = XLSX.utils.decode_range(ref);
  return {
    startRow: range.s.r + 1,
    endRow: range.e.r + 1,
    startCol: range.s.c,
    endCol: range.e.c,
    ref,
  };
}

export function normalizeHeaderName(value) {
  return collapseWs(value)
    .replace(/\((?:\d{6}|\d{2,4}[-./]\d{1,2}[-./]\d{1,2})\)/g, "")
    .replace(/\s+\/\s+/g, " / ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\/\s*$/g, "")
    .replace(/^\s*\/\s+/g, "")
    .trim();
}

export function combineHeaderParts(parts) {
  const unique = [];
  for (const part of parts || []) {
    const text = collapseWs(part);
    if (!text) {
      continue;
    }
    if (!unique.includes(text)) {
      unique.push(text);
    }
  }
  return unique.join(" / ");
}

function headerText(cell) {
  if (!cell) {
    return "";
  }
  if (cell.t === "s" || cell.t === "str") {
    return collapseWs(cell.v);
  }
  if (cell.w != null && String(cell.w).trim() !== "") {
    return collapseWs(cell.w);
  }
  if (cell.v == null) {
    return "";
  }
  return collapseWs(cell.v);
}

export function mergedStartValues(sheet) {
  const map = new Map();
  for (const merge of sheet?.["!merges"] || []) {
    const startAddr = XLSX.utils.encode_cell(merge.s);
    const text = headerText(sheet[startAddr]);
    for (let r = merge.s.r; r <= merge.e.r; r += 1) {
      for (let c = merge.s.c; c <= merge.e.c; c += 1) {
        map.set(`${r},${c}`, text);
      }
    }
  }
  return map;
}

function headerCellAt(sheet, mergeMap, row0, col0) {
  const address = XLSX.utils.encode_cell({ r: row0, c: col0 });
  const direct = headerText(sheet[address]);
  if (direct) {
    return direct;
  }
  return mergeMap.get(`${row0},${col0}`) || "";
}

function parseLooseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value == null) {
    return null;
  }
  const text = String(value).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function refValue(sheet, ref) {
  const addr = String(ref).replace(/\$/g, "").toUpperCase();
  const cell = sheet[addr];
  if (!cell) {
    return null;
  }
  if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
    return cell.v;
  }
  const fromV = parseLooseNumber(cell.v);
  if (fromV != null) {
    return fromV;
  }
  return parseLooseNumber(cell.w);
}

export function tryEvalSimpleFormula(formula, sheet) {
  if (!formula || !sheet) {
    return null;
  }
  const expr = String(formula)
    .replace(/^=/, "")
    .replace(/\$/g, "")
    .replace(/\s+/g, "")
    .trim();
  const mul = expr.match(/^([A-Z]+\d+)\*([A-Z]+\d+)$/i);
  if (mul) {
    const left = refValue(sheet, mul[1]);
    const right = refValue(sheet, mul[2]);
    if (left != null && right != null) {
      return left * right;
    }
    return null;
  }
  const add = expr.match(/^([A-Z]+\d+)\+([A-Z]+\d+)$/i);
  if (add) {
    const left = refValue(sheet, add[1]);
    const right = refValue(sheet, add[2]);
    if (left != null && right != null) {
      return left + right;
    }
  }
  return null;
}

function identifierValue(cell) {
  if (!cell) {
    return null;
  }
  if (cell.t === "s" || cell.t === "str") {
    const text = cell.v == null ? "" : String(cell.v).trim();
    return text === "" ? null : text;
  }
  if (cell.t === "n" && typeof cell.v === "number" && Number.isFinite(cell.v)) {
    if (Number.isSafeInteger(cell.v)) {
      return String(cell.v);
    }
    if (cell.w && !/[eE]/.test(String(cell.w))) {
      const fromW = String(cell.w).replace(/,/g, "").trim();
      if (fromW) {
        return fromW;
      }
    }
    return String(cell.v);
  }
  if (cell.w != null && String(cell.w).trim() !== "") {
    const fromW = String(cell.w).trim();
    if (/[eE]/.test(fromW) && typeof cell.v === "number" && Number.isSafeInteger(cell.v)) {
      return String(cell.v);
    }
    return fromW;
  }
  if (cell.v == null) {
    return null;
  }
  return String(cell.v).trim() || null;
}

function dataCellValue(cell, sheet) {
  if (!cell) {
    return null;
  }
  const formula = cell.f ? String(cell.f) : null;
  if (typeof cell.v === "string" && cell.v.trim().startsWith("=")) {
    const computed = tryEvalSimpleFormula(cell.v, sheet);
    return computed;
  }
  if (formula) {
    if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
      return cell.v;
    }
    const computed = tryEvalSimpleFormula(formula, sheet);
    if (computed != null) {
      return computed;
    }
    return null;
  }
  if (cell.t === "n" && typeof cell.v === "number" && Number.isFinite(cell.v)) {
    return cell.v;
  }
  if (cell.t === "s" || cell.t === "str") {
    return cell.v == null ? null : String(cell.v);
  }
  if (cell.v == null) {
    if (cell.w != null && String(cell.w).trim() !== "") {
      return String(cell.w);
    }
    return null;
  }
  return cell.v;
}

export function cellValue(sheet, row1Based, col0Based, { identifier = false } = {}) {
  const address = XLSX.utils.encode_cell({ r: row1Based - 1, c: col0Based });
  const cell = sheet[address];
  const formula = cell?.f ? String(cell.f) : null;
  if (identifier) {
    return { value: identifierValue(cell), formula };
  }
  return { value: dataCellValue(cell, sheet), formula };
}

export function headerRangeFromRecord(item, fallback) {
  if (item?.header_start_row != null && item?.header_end_row != null) {
    return {
      headerStartRow: Number(item.header_start_row),
      headerEndRow: Number(item.header_end_row),
      dataStartRow: Number(item.data_start_row ?? Number(item.header_end_row) + 1),
    };
  }
  if (item?.header_row_number) {
    const n = Number(item.header_row_number);
    return { headerStartRow: n, headerEndRow: n, dataStartRow: n + 1 };
  }
  return fallback || { headerStartRow: 1, headerEndRow: 1, dataStartRow: 2 };
}

export function assertHeaderRange({ headerStartRow, headerEndRow, dataStartRow }) {
  if (!Number.isInteger(headerStartRow) || headerStartRow < 1) {
    throw new AppError("INVALID_HEADER_ROW", "헤더 시작 행은 1 이상의 정수여야 합니다.", 400);
  }
  if (!Number.isInteger(headerEndRow) || headerEndRow < headerStartRow) {
    throw new AppError("INVALID_HEADER_ROW", "헤더 종료 행은 시작 행 이상이어야 합니다.", 400);
  }
  if (!Number.isInteger(dataStartRow) || dataStartRow <= headerEndRow) {
    throw new AppError("INVALID_DATA_START_ROW", "데이터 시작 행은 헤더 종료 행보다 커야 합니다.", 400);
  }
  return { headerStartRow, headerEndRow, dataStartRow };
}

function isNumericLike(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return true;
  }
  if (typeof value === "string") {
    return /^-?\d+(?:[.,]\d+)?$/.test(value.trim().replace(/,/g, ""));
  }
  return false;
}

function classifyRow(cells) {
  const nonEmpty = cells.filter((value) => !isBlank(value));
  if (nonEmpty.length === 0) {
    return "empty";
  }
  let text = 0;
  let numeric = 0;
  for (const value of nonEmpty) {
    if (isNumericLike(value)) {
      numeric += 1;
    } else if (typeof value === "string") {
      text += 1;
    } else {
      text += 1;
    }
  }
  if (numeric >= 2 || (numeric >= 1 && text >= 1)) {
    return "data";
  }
  if (text / nonEmpty.length >= 0.6) {
    return "header";
  }
  if (numeric > 0) {
    return "data";
  }
  return "header";
}

function detectRowValues(sheet, range, row1, mergeMap) {
  const cells = [];
  for (let c = range.startCol; c <= range.endCol; c += 1) {
    const address = XLSX.utils.encode_cell({ r: row1 - 1, c });
    const cell = sheet[address];
    if (cell?.t === "n" && typeof cell.v === "number") {
      cells.push(cell.v);
      continue;
    }
    const text = headerCellAt(sheet, mergeMap, row1 - 1, c);
    if (text) {
      cells.push(text);
      continue;
    }
    if (cell?.v != null && !isBlank(cell.v)) {
      cells.push(cell.v);
      continue;
    }
    cells.push(null);
  }
  return cells;
}

export function detectHeaderRange(sheet) {
  const range = usedRange(sheet);
  if (!range.ref || range.endRow < 1) {
    return { headerStartRow: 1, headerEndRow: 1, dataStartRow: 2, detected: false };
  }
  const scanEnd = Math.min(range.endRow, 10);
  const mergeMap = mergedStartValues(sheet);
  const kinds = [];
  for (let r = range.startRow; r <= scanEnd; r += 1) {
    kinds.push({ row: r, kind: classifyRow(detectRowValues(sheet, range, r, mergeMap)) });
  }
  const firstData = kinds.find((item) => item.kind === "data");
  if (!firstData || firstData.row <= range.startRow) {
    return { headerStartRow: range.startRow, headerEndRow: range.startRow, dataStartRow: range.startRow + 1, detected: false };
  }
  const before = kinds.filter((item) => item.row < firstData.row);
  const headerLike = before.filter((item) => item.kind === "header");
  const start = headerLike.length ? headerLike[0].row : range.startRow;
  let end = start;
  for (const item of before) {
    if (item.row < start) {
      continue;
    }
    if (item.kind === "empty") {
      continue;
    }
    if (item.kind === "header" && item.row <= end + 1) {
      end = item.row;
      continue;
    }
    break;
  }
  end = Math.min(end, start + 2, firstData.row - 1);
  if (end < start) {
    end = firstData.row - 1;
  }
  return {
    headerStartRow: start,
    headerEndRow: Math.max(start, end),
    dataStartRow: firstData.row,
    detected: true,
  };
}

export function buildLogicalHeaders(sheet, { headerStartRow, headerEndRow }) {
  const range = usedRange(sheet);
  if (!range.ref || headerStartRow > range.endRow) {
    throw new AppError("INVALID_HEADER_ROW", "선택한 헤더 행이 시트 범위를 벗어납니다.", 400);
  }
  const mergeMap = mergedStartValues(sheet);
  const columns = [];
  const depth = headerEndRow - headerStartRow + 1;
  for (let c = range.startCol; c <= range.endCol; c += 1) {
    const excelCol = XLSX.utils.encode_col(c);
    const parts = [];
    for (let r = headerStartRow; r <= headerEndRow; r += 1) {
      parts.push(headerCellAt(sheet, mergeMap, r - 1, c));
    }
    const cleanedParts = parts.map(collapseWs);
    const rawHeader = combineHeaderParts(cleanedParts) || excelCol;
    const compositeHeader = combineHeaderParts(cleanedParts.map((part) => normalizeHeaderName(part))) || excelCol;
    const parentPart = cleanedParts.find((part) => part) || "";
    const parentNormalized = normalizeHeaderName(parentPart) || compositeHeader;
    columns.push({
      excel_col: excelCol,
      column_index: c,
      name: compositeHeader,
      display_name: compositeHeader,
      normalized_name: compositeHeader,
      raw_header: rawHeader,
      composite_header: compositeHeader,
      parent_normalized: parentNormalized,
      normalized_header: parentNormalized,
      header_parts: cleanedParts.filter(Boolean),
      header_depth: depth,
      index: c,
    });
  }
  return { range, columns };
}

export function suggestQuantityFallback(columns = []) {
  const ipsu = columns.find((col) => {
    const name = col.composite_header || col.normalized_name || "";
    return name === "입수" || name.endsWith(" / 입수");
  });
  const box = columns.find((col) => {
    const name = String(col.composite_header || col.normalized_name || "").replace(/\s/g, "");
    return /발주box/i.test(name) || (col.composite_header || col.normalized_name) === "발주 / 발주box";
  });
  if (!ipsu || !box) {
    return null;
  }
  return {
    op: "MUL",
    columns: [ipsu.composite_header || ipsu.normalized_name, box.composite_header || box.normalized_name],
  };
}

export function isSumFormula(formula) {
  if (!formula) {
    return false;
  }
  return /^SUM[A-Z]*\s*\(/i.test(String(formula).replace(/^=/, "").trim());
}

export function isTotalOrEmptySkipRow({ raw = {}, formulas = {}, hasProductName, hasProductCode }) {
  if (hasProductName || hasProductCode) {
    return false;
  }
  const formulaList = Object.values(formulas || {});
  const hasSum = formulaList.some((formula) => isSumFormula(formula));
  const hasTotalText = Object.values(raw).some((value) => collapseWs(value).replace(/\s/g, "").includes("합계"));
  return hasSum || hasTotalText;
}

export function parseFactor(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1) {
      return null;
    }
    return value;
  }
  const text = String(value).trim().replace(/,/g, "");
  if (!/^[1-9]\d*$/.test(text)) {
    return null;
  }
  return Number(text);
}

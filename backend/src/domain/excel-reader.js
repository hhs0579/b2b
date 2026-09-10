import XLSX from "xlsx";
import { AppError } from "../utils/app-error.js";
import { env } from "../config/env.js";
import {
  buildLogicalHeaders,
  cellValue,
  usedRange,
} from "./excel-headers.js";

/**
 * 발주서 READ/PARSE 전용.
 * XLSX.write / writeFile은 여기서 호출하지 않는다.
 * 원본 workbook을 다시 저장하지 않는다.
 */

function isBlank(value) {
  return value == null || String(value).trim() === "";
}

function assertWorkbookLimits(workbook) {
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new AppError("INVALID_EXCEL", "엑셀 시트를 찾을 수 없습니다.", 400);
  }
  if (sheetNames.length > env.EXCEL_MAX_SHEETS) {
    throw new AppError("EXCEL_TOO_LARGE", "엑셀 시트 수가 허용 범위를 초과합니다.", 400);
  }
  for (const name of sheetNames) {
    const range = usedRange(workbook.Sheets[name] || {});
    const rows = Math.max(0, range.endRow - range.startRow + 1);
    const cols = range.endCol - range.startCol + 1;
    if (rows > env.EXCEL_MAX_ROWS || cols > env.EXCEL_MAX_COLS) {
      throw new AppError("EXCEL_TOO_LARGE", "엑셀 사용 영역이 허용 범위를 초과합니다.", 400);
    }
  }
}

export function readWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError("INVALID_EXCEL", "엑셀 파일이 비어 있습니다.", 400);
  }
  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      cellNF: true,
      cellText: true,
    });
  } catch (err) {
    const wrapped = new AppError("INVALID_EXCEL", "엑셀 파일을 읽을 수 없습니다.", 400);
    wrapped.cause = err;
    throw wrapped;
  }
  assertWorkbookLimits(workbook);
  return workbook;
}

function sheetMatrix(sheet, { identifierCols = new Set() } = {}) {
  const range = usedRange(sheet);
  const rows = [];
  if (range.endRow < range.startRow) {
    return { range, rows, columnCount: 0 };
  }
  for (let r = range.startRow; r <= range.endRow; r += 1) {
    const cells = [];
    for (let c = range.startCol; c <= range.endCol; c += 1) {
      const colName = XLSX.utils.encode_col(c);
      const identifier = identifierCols.has(colName) || identifierCols.has(c);
      cells.push(cellValue(sheet, r, c, { identifier }).value);
    }
    rows.push({ rowNumber: r, cells });
  }
  return { range, rows, columnCount: range.endCol - range.startCol + 1 };
}

export function listSheets(workbook, { previewRows = 40 } = {}) {
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const { range, rows, columnCount } = sheetMatrix(sheet);
    const columns = [];
    for (let c = range.startCol; c <= range.endCol; c += 1) {
      columns.push(XLSX.utils.encode_col(c));
    }
    const preview = rows.slice(0, previewRows).map((row) => ({
      row_number: row.rowNumber,
      cells: row.cells.map((value) => (value == null ? "" : String(value))),
    }));
    return {
      sheet_name: name,
      used_range: range.ref,
      row_count: Math.max(0, range.endRow),
      column_count: Math.max(0, columnCount),
      columns,
      preview,
    };
  });
}

export function headerFromRow(sheet, headerRowNumber, options = {}) {
  const headerStartRow = options.headerStartRow ?? headerRowNumber;
  const headerEndRow = options.headerEndRow ?? headerRowNumber;
  return buildLogicalHeaders(sheet, { headerStartRow, headerEndRow });
}

function isIdentifierColumn(col, identifierHeaders) {
  if (!identifierHeaders || identifierHeaders.size === 0) {
    return false;
  }
  return (
    identifierHeaders.has(col.name) ||
    identifierHeaders.has(col.display_name) ||
    identifierHeaders.has(col.normalized_name) ||
    identifierHeaders.has(col.composite_header) ||
    identifierHeaders.has(col.excel_col)
  );
}

export function extractDataRows(sheet, headerRowNumber, options = {}) {
  const headerStartRow = options.headerStartRow ?? headerRowNumber;
  const headerEndRow = options.headerEndRow ?? headerRowNumber;
  const dataStartRow = options.dataStartRow ?? headerEndRow + 1;
  const identifierHeaders = options.identifierHeaders || new Set();
  const { range, columns } = headerFromRow(sheet, headerRowNumber, {
    headerStartRow,
    headerEndRow,
  });
  const identifierCols = new Set(
    columns.filter((col) => isIdentifierColumn(col, identifierHeaders)).map((col) => col.excel_col),
  );
  const data = [];
  const endRow = range.endRow;
  for (let r = dataStartRow; r <= endRow; r += 1) {
    const raw = {};
    const formulas = {};
    let hasValue = false;
    columns.forEach((col) => {
      const colIndex = Number.isInteger(col.column_index) ? col.column_index : range.startCol + col.index;
      const identifier = identifierCols.has(col.excel_col);
      const { value, formula } = cellValue(sheet, r, colIndex, { identifier });
      const stored = value == null ? null : value;
      raw[col.excel_col] = stored;
      if (col.composite_header) {
        raw[col.composite_header] = stored;
      }
      if (col.raw_header && col.raw_header !== col.composite_header) {
        raw[col.raw_header] = stored;
      }
      if (col.display_name && col.display_name !== col.composite_header && col.display_name !== col.excel_col) {
        raw[col.display_name] = stored;
      }
      if (formula) {
        formulas[col.excel_col] = formula;
        if (col.composite_header) {
          formulas[col.composite_header] = formula;
        }
      }
      if (!isBlank(value)) {
        hasValue = true;
      }
    });
    if (!hasValue) {
      continue;
    }
    data.push({
      source_row_number: r,
      raw_row_json: raw,
      formulas,
    });
  }
  return {
    used_range: range.ref,
    columns: columns.map((col) => col.name),
    header_columns: columns,
    rows: data,
  };
}

export function getSheet(workbook, sheetName) {
  const name = sheetName || workbook.SheetNames[0];
  if (!workbook.SheetNames.includes(name)) {
    throw new AppError("SHEET_NOT_FOUND", "선택한 시트를 찾을 수 없습니다.", 400);
  }
  return { name, sheet: workbook.Sheets[name] };
}

export { usedRange };

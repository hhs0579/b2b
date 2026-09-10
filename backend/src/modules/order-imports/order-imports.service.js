import { pool } from "../../db/pool.js";
import { AppError } from "../../utils/app-error.js";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
import {
  optionalBooleanQuery,
  optionalText,
  parseId,
  requiredDate,
  requiredInt,
} from "../../utils/validation.js";
import { todayKst } from "../../domain/dates.js";
import { normalizeAliasText } from "../../domain/normalize.js";
import {
  buildFieldColumnsMeta,
  findMappedColumn,
  mappingColumnsNotFound,
  mappedFieldForColumn,
  requiredMappingMissing,
  sanitizeColumnMap,
  sanitizeMappingMeta,
  stabilizeColumnMap,
  suggestColumnMap,
} from "../../domain/excel-mapping.js";
import {
  extractDataRows,
  getSheet,
  headerFromRow,
  listSheets,
  readWorkbook,
} from "../../domain/excel-reader.js";
import {
  assertHeaderRange,
  detectHeaderRange,
  headerRangeFromRecord,
  isTotalOrEmptySkipRow,
  suggestQuantityFallback,
} from "../../domain/excel-headers.js";
import {
  applyEffectiveQuantity,
  mappedText,
  matchProduct,
  normalizeProductCode,
  parseQuantity,
  resolveParsedQuantity,
  rowIdentityKey,
} from "../../domain/order-parse.js";
import {
  assertAllowedExcelName,
  decodeOriginalFileName,
  deleteStoredOrderFile,
  readStoredOrderFile,
  saveOrderUploadBuffer,
  sha256,
} from "../../utils/order-files.js";
import * as salesClientsRepository from "../sales-clients/sales-clients.repository.js";
import * as excelMappingsRepository from "../excel-mappings/excel-mappings.repository.js";
import * as productAliasesRepository from "../product-aliases/product-aliases.repository.js";
import * as orderImportsRepository from "./order-imports.repository.js";
import * as ordersService from "../orders/orders.service.js";
import * as ordersRepository from "../orders/orders.repository.js";
import { insertAuditLog } from "../audit/audit.repository.js";
import { orderImportImpact } from "../deletions/impact.repository.js";
import { deleteOrderUploadAfterCommit } from "../../utils/storage-cleanup.js";

const IDENTIFIER_FIELDS = [
  "external_product_code",
  "external_product_name",
  "external_option_name",
  "external_order_number",
  "recipient_name",
  "phone",
  "address",
  "shipping_memo",
];

function publicImport(row) {
  if (!row) {
    return row;
  }
  const { stored_file_path: _hidden, ...rest } = row;
  return rest;
}

async function requireImport(idParam) {
  const id = parseId(idParam);
  const item = await orderImportsRepository.getImportById(id);
  if (!item) {
    throw new AppError("IMPORT_NOT_FOUND", "발주서 업로드를 찾을 수 없습니다.", 404);
  }
  return item;
}

async function requireActiveClient(id) {
  const client = await salesClientsRepository.getSalesClientById(id);
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  if (!client.is_active) {
    throw new AppError("CLIENT_INACTIVE", "비활성 매출처에는 발주서를 업로드할 수 없습니다.", 400);
  }
  return client;
}

function mappingCheck(columnMap, headers, mappingMeta = {}) {
  const missingRequired = requiredMappingMissing(columnMap);
  const missingColumns = mappingColumnsNotFound(columnMap, headers, mappingMeta);
  return {
    missingRequired,
    missingColumns,
    ok: missingRequired.length === 0 && missingColumns.length === 0,
  };
}

function publicHeaderColumns(columns, columnMap) {
  return (columns || []).map((col) => ({
    excel_col: col.excel_col,
    column_index: col.column_index,
    display_name: col.composite_header || col.display_name || col.name,
    normalized_name: col.composite_header || col.normalized_name,
    raw_header: col.raw_header,
    composite_header: col.composite_header,
    parent_normalized: col.parent_normalized,
    header_depth: col.header_depth,
    mapped_field: mappedFieldForColumn(columnMap, col),
  }));
}

function composeMappingMeta(columnMap, headerColumns, incoming = {}) {
  const sanitized = sanitizeMappingMeta(incoming);
  return sanitizeMappingMeta({
    ...sanitized,
    field_columns: buildFieldColumnsMeta(columnMap, headerColumns),
    quantity_fallback: sanitized.quantity_fallback || suggestQuantityFallback(headerColumns) || undefined,
  });
}

function parseHeaderRangeInput(body, item, detected) {
  const hasMulti =
    body.header_start_row != null || body.header_end_row != null || body.data_start_row != null;
  if (hasMulti) {
    const start = requiredInt(body.header_start_row ?? item?.header_start_row ?? detected?.headerStartRow ?? 1, {
      min: 1,
      code: "INVALID_HEADER_ROW",
      message: "헤더 시작 행은 1 이상의 정수여야 합니다.",
    });
    const end = requiredInt(body.header_end_row ?? body.header_start_row ?? item?.header_end_row ?? start, {
      min: 1,
      code: "INVALID_HEADER_ROW",
      message: "헤더 종료 행은 1 이상의 정수여야 합니다.",
    });
    const data = requiredInt(body.data_start_row ?? end + 1, {
      min: 1,
      code: "INVALID_DATA_START_ROW",
      message: "데이터 시작 행은 1 이상의 정수여야 합니다.",
    });
    return assertHeaderRange({ headerStartRow: start, headerEndRow: end, dataStartRow: data });
  }
  if (body.header_row_number != null) {
    const n = requiredInt(body.header_row_number, {
      min: 1,
      code: "INVALID_HEADER_ROW",
      message: "헤더 행 번호는 1 이상의 정수여야 합니다.",
    });
    return { headerStartRow: n, headerEndRow: n, dataStartRow: n + 1 };
  }
  return assertHeaderRange(headerRangeFromRecord(item, detected || { headerStartRow: 1, headerEndRow: 1, dataStartRow: 2 }));
}

function applySavedOrSuggestedMap(savedMapping, columns) {
  if (!savedMapping) {
    return suggestColumnMap(columns);
  }
  const stabilized = stabilizeColumnMap(sanitizeColumnMap(savedMapping.column_map || {}), columns);
  const suggested = suggestColumnMap(columns);
  const merged = { ...stabilized };
  for (const [field, binding] of Object.entries(suggested)) {
    if (!merged[field]) {
      merged[field] = binding;
    }
  }
  return stabilizeColumnMap(merged, columns);
}

function identifierHeadersFromMap(columnMap, headerColumns, mappingMeta) {
  const names = new Set();
  for (const field of IDENTIFIER_FIELDS) {
    const stored = columnMap[field];
    if (!stored) {
      continue;
    }
    const col = findMappedColumn(headerColumns, stored, mappingMeta, field);
    if (col) {
      names.add(col.name);
      names.add(col.display_name);
      names.add(col.normalized_name);
      names.add(col.composite_header);
      names.add(col.excel_col);
    }
  }
  return names;
}

function withMappingMeta(item, headerColumns = [], extra = {}) {
  const mappingMeta = item.mapping_meta || {};
  const resolved = headerColumns.length
    ? stabilizeColumnMap(sanitizeColumnMap(item.column_map || {}), headerColumns)
    : sanitizeColumnMap(item.column_map || {});
  const check = headerColumns.length
    ? mappingCheck(resolved, headerColumns, mappingMeta)
    : mappingCheck(resolved, [], mappingMeta);
  return {
    ...publicImport(item),
    column_map: resolved,
    mapping_ok: check.ok,
    mapping_missing_required: check.missingRequired,
    mapping_missing_columns: check.missingColumns,
    header_columns: publicHeaderColumns(headerColumns, resolved),
    ...extra,
  };
}

async function headersForImport(item) {
  if (!item.sheet_name) {
    return { columns: [], suggested: null };
  }
  const buffer = await readStoredOrderFile(item.stored_file_name);
  const workbook = readWorkbook(buffer);
  const { sheet } = getSheet(workbook, item.sheet_name);
  const suggested = detectHeaderRange(sheet);
  const range = headerRangeFromRecord(item, suggested);
  const { columns } = headerFromRow(sheet, range.headerEndRow, {
    headerStartRow: range.headerStartRow,
    headerEndRow: range.headerEndRow,
  });
  return { columns, suggested, range, sheet };
}

function buildMatchIndexes(aliases, products) {
  const aliasesByKey = new Map(aliases.map((item) => [item.key, item]));
  const productsByCode = new Map();
  const productsByBarcode = new Map();
  const productsByNameOption = new Map();
  const productsByName = new Map();
  for (const product of products) {
    const codeKey = normalizeProductCode(product.product_code);
    if (codeKey && !productsByCode.has(codeKey)) {
      productsByCode.set(codeKey, product);
    }
    const barcodeKey = normalizeProductCode(product.barcode);
    if (barcodeKey && !productsByBarcode.has(barcodeKey)) {
      productsByBarcode.set(barcodeKey, product);
    }
    const nameKey = `${normalizeAliasText(product.product_name)}|${normalizeAliasText(product.option_name)}`;
    const list = productsByNameOption.get(nameKey) || [];
    list.push(product);
    productsByNameOption.set(nameKey, list);
    const nName = normalizeAliasText(product.product_name);
    if (nName) {
      const byName = productsByName.get(nName) || [];
      byName.push(product);
      productsByName.set(nName, byName);
    }
  }
  return { aliasesByKey, productsByCode, productsByBarcode, productsByNameOption, productsByName };
}

function validationErrorsForRow({
  externalProductName,
  externalProductCode,
  matchStatus,
  effectiveQuantity,
}) {
  const errors = [];
  if (!externalProductName && !externalProductCode) {
    errors.push("상품명 또는 상품코드가 필요합니다.");
  }
  const quantityResult = parseQuantity(effectiveQuantity);
  if (!quantityResult.ok) {
    errors.push(quantityResult.error);
  }
  if (matchStatus === "MATCHED_BUT_INACTIVE") {
    errors.push("연결된 상품이 비활성 상태입니다.");
  }
  return errors;
}

function parseOneRow(row, columnMap, matchIndexes, sheetName, headerColumns = [], mappingMeta = {}) {
  const raw = row.raw_row_json;
  const externalProductName = mappedText(raw, columnMap, "external_product_name", headerColumns, mappingMeta);
  const externalProductCode = mappedText(raw, columnMap, "external_product_code", headerColumns, mappingMeta);
  const externalOptionName = mappedText(raw, columnMap, "external_option_name", headerColumns, mappingMeta);
  const quantityResult = resolveParsedQuantity(raw, columnMap, headerColumns, mappingMeta);
  const parsed_quantity = quantityResult.ok ? quantityResult.quantity : null;
  const qty = applyEffectiveQuantity({ parsed_quantity, manual_quantity: null });
  const match = matchProduct({
    aliasesByKey: matchIndexes.aliasesByKey,
    productsByCode: matchIndexes.productsByCode,
    productsByBarcode: matchIndexes.productsByBarcode,
    productsByNameOption: matchIndexes.productsByNameOption,
    productsByName: matchIndexes.productsByName,
    externalProductCode,
    externalProductName,
    externalOptionName,
  });
  const errors = validationErrorsForRow({
    externalProductName,
    externalProductCode,
    matchStatus: match.match_status,
    effectiveQuantity: qty.quantity,
  });
  return {
    source_sheet_name: sheetName,
    source_row_number: row.source_row_number,
    external_order_number: mappedText(raw, columnMap, "external_order_number", headerColumns, mappingMeta),
    external_product_code: externalProductCode,
    external_product_name: externalProductName,
    external_option_name: externalOptionName,
    ...qty,
    recipient_name: mappedText(raw, columnMap, "recipient_name", headerColumns, mappingMeta),
    phone: mappedText(raw, columnMap, "phone", headerColumns, mappingMeta),
    address: mappedText(raw, columnMap, "address", headerColumns, mappingMeta),
    shipping_memo: mappedText(raw, columnMap, "shipping_memo", headerColumns, mappingMeta),
    matched_product_option_id: match.matched_product_option_id,
    matched_product_id: match.matched_product_id,
    match_status: match.match_status,
    validation_status: errors.length === 0 ? "VALID" : "INVALID",
    validation_errors: errors,
    raw_row_json: raw,
  };
}

function shouldSkipImportRow(row, columnMap, headerColumns, mappingMeta) {
  const name = mappedText(row.raw_row_json, columnMap, "external_product_name", headerColumns, mappingMeta);
  const code = mappedText(row.raw_row_json, columnMap, "external_product_code", headerColumns, mappingMeta);
  return isTotalOrEmptySkipRow({
    raw: row.raw_row_json,
    formulas: row.formulas,
    hasProductName: Boolean(name),
    hasProductCode: Boolean(code),
  });
}

function applyPreservedManualQuantity(parsedRows, previousRows) {
  const previousByKey = new Map(previousRows.map((row) => [rowIdentityKey(row), row]));
  return parsedRows.map((row) => {
    const previous = previousByKey.get(rowIdentityKey(row));
    if (previous?.manual_quantity == null) {
      return row;
    }
    const qty = applyEffectiveQuantity({
      parsed_quantity: row.parsed_quantity,
      manual_quantity: previous.manual_quantity,
    });
    const errors = validationErrorsForRow({
      externalProductName: row.external_product_name,
      externalProductCode: row.external_product_code,
      matchStatus: row.match_status,
      effectiveQuantity: qty.quantity,
    });
    return {
      ...row,
      ...qty,
      validation_status: errors.length === 0 ? "VALID" : "INVALID",
      validation_errors: errors,
    };
  });
}

function summarize(parsedRows) {
  const parsed_row_count = parsedRows.length;
  const valid_row_count = parsedRows.filter((row) => row.validation_status === "VALID").length;
  const invalid_row_count = parsedRows.filter((row) => row.validation_status === "INVALID").length;
  const unmatched_row_count = parsedRows.filter((row) => row.match_status === "UNMATCHED").length;
  const matched_row_count = parsedRows.filter((row) =>
    ["MATCHED_ALIAS", "MATCHED_PRODUCT_CODE", "MATCHED_BARCODE", "MATCHED_EXACT", "MANUAL"].includes(row.match_status),
  ).length;
  const ready =
    parsed_row_count > 0 &&
    invalid_row_count === 0 &&
    unmatched_row_count === 0 &&
    parsedRows.every((row) =>
      ["MATCHED_ALIAS", "MATCHED_PRODUCT_CODE", "MATCHED_BARCODE", "MATCHED_EXACT", "MANUAL"].includes(row.match_status),
    );
  return {
    source_row_count: parsed_row_count,
    parsed_row_count,
    valid_row_count,
    invalid_row_count,
    matched_row_count,
    unmatched_row_count,
    status: ready ? "READY" : "PARSED",
  };
}

export async function listImports(query) {
  const items = await orderImportsRepository.listImports({
    clientId: query.client_id ? parseId(query.client_id, "INVALID_CLIENT_ID") : undefined,
    status: optionalText(query.status),
  });
  return { items: items.map(publicImport) };
}

export async function getImport(idParam) {
  const item = await requireImport(idParam);
  let columns = [];
  let suggested = null;
  try {
    const headers = await headersForImport(item);
    columns = headers.columns;
    suggested = headers.suggested;
  } catch (err) {
    logger.error("Failed to read import workbook for mapping check", err);
  }
  return withMappingMeta(item, columns, {
    suggested_header_range: suggested,
  });
}

export async function uploadImport({ file, body }) {
  if (!file?.buffer) {
    throw new AppError("FILE_REQUIRED", "발주서 파일이 필요합니다.", 400);
  }
  if (file.size > env.UPLOAD_MAX_BYTES || file.buffer.length > env.UPLOAD_MAX_BYTES) {
    throw new AppError("FILE_TOO_LARGE", `파일 크기는 ${Math.floor(env.UPLOAD_MAX_BYTES / (1024 * 1024))}MB 이하여야 합니다.`, 400);
  }
  const originalFileName = decodeOriginalFileName(file.originalname);
  const ext = assertAllowedExcelName(originalFileName);
  const clientId = parseId(body.client_id, "INVALID_CLIENT_ID");
  await requireActiveClient(clientId);
  const orderDate = body.order_date ? requiredDate(body.order_date) : todayKst();
  const duplicateAcknowledged = optionalBooleanQuery(body.duplicate_acknowledged) === true;

  let workbook;
  try {
    workbook = readWorkbook(file.buffer);
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    logger.error("Excel parse failed during upload", err);
    throw new AppError("INVALID_EXCEL", "엑셀 파일을 읽을 수 없습니다.", 400);
  }

  const fileHash = sha256(file.buffer);
  const duplicateId = await orderImportsRepository.findDuplicateHash(clientId, fileHash);
  const duplicateDetected = duplicateId != null;

  const savedMapping = await excelMappingsRepository.getActiveMapping(clientId);
  const sheets = listSheets(workbook);
  const defaultSheet =
    savedMapping?.sheet_name && sheets.some((sheet) => sheet.sheet_name === savedMapping.sheet_name)
      ? savedMapping.sheet_name
      : sheets[0].sheet_name;
  const { sheet } = getSheet(workbook, defaultSheet);
  const suggested = detectHeaderRange(sheet);
  const range = savedMapping
    ? headerRangeFromRecord(savedMapping, suggested)
    : suggested;
  const { columns } = headerFromRow(sheet, range.headerEndRow, {
    headerStartRow: range.headerStartRow,
    headerEndRow: range.headerEndRow,
  });
  const columnMap = applySavedOrSuggestedMap(savedMapping, columns);
  const mappingMeta = composeMappingMeta(columnMap, columns, savedMapping?.mapping_meta || {});
  const check = mappingCheck(columnMap, columns, mappingMeta);
  const status = check.ok && Object.keys(columnMap).length > 0 ? "UPLOADED" : "MAPPING_REQUIRED";

  const saved = await saveOrderUploadBuffer(file.buffer, ext);
  try {
    const created = await orderImportsRepository.insertImport({
      client_id: clientId,
      order_date: orderDate,
      original_file_name: originalFileName,
      stored_file_name: saved.storedFileName,
      stored_file_path: saved.storedFilePath,
      file_hash: fileHash,
      file_size: file.buffer.length,
      sheet_name: defaultSheet,
      header_row_number: range.headerEndRow,
      header_start_row: range.headerStartRow,
      header_end_row: range.headerEndRow,
      data_start_row: range.dataStartRow,
      column_map: Object.keys(columnMap).length ? columnMap : null,
      mapping_meta: mappingMeta,
      status,
      duplicate_hash_detected: duplicateDetected,
      duplicate_acknowledged: duplicateDetected ? duplicateAcknowledged : false,
    });
    return {
      ...withMappingMeta(created, columns, { suggested_header_range: suggested }),
      duplicate_of_id: duplicateId,
    };
  } catch (err) {
    await deleteStoredOrderFile(saved.storedFileName);
    throw err;
  }
}

export async function rawPreview(idParam, query) {
  const item = await requireImport(idParam);
  const buffer = await readStoredOrderFile(item.stored_file_name);
  const workbook = readWorkbook(buffer);
  const previewRows = query.max_rows
    ? requiredInt(query.max_rows, { min: 1, code: "INVALID_MAX_ROWS", message: "미리보기 행 수가 올바르지 않습니다." })
    : 40;
  const sheets = listSheets(workbook, { previewRows: Math.min(previewRows, 50) });
  const selected = query.sheet_name || item.sheet_name || sheets[0]?.sheet_name;
  const { sheet } = getSheet(workbook, selected);
  const suggested = detectHeaderRange(sheet);
  let range;
  if (query.header_start_row != null || query.header_end_row != null || query.data_start_row != null) {
    range = parseHeaderRangeInput(query, item, suggested);
  } else {
    range = headerRangeFromRecord(item, suggested);
  }
  const { columns } = headerFromRow(sheet, range.headerEndRow, {
    headerStartRow: range.headerStartRow,
    headerEndRow: range.headerEndRow,
  });
  const columnMap = stabilizeColumnMap(sanitizeColumnMap(item.column_map || {}), columns);
  return {
    import: publicImport(item),
    selected_sheet: selected,
    sheets,
    header_start_row: range.headerStartRow,
    header_end_row: range.headerEndRow,
    data_start_row: range.dataStartRow,
    suggested_header_range: suggested,
    header_columns: publicHeaderColumns(columns, columnMap),
  };
}

export async function updateConfig(idParam, body) {
  const item = await requireImport(idParam);
  await ordersService.assertImportNotConfirmed(item.id);
  await requireActiveClient(item.client_id);
  const sheetName = optionalText(body.sheet_name) || item.sheet_name;
  const buffer = await readStoredOrderFile(item.stored_file_name);
  const workbook = readWorkbook(buffer);
  const { sheet } = getSheet(workbook, sheetName);
  const suggested = detectHeaderRange(sheet);
  const range = parseHeaderRangeInput(body, item, suggested);
  const { columns } = headerFromRow(sheet, range.headerEndRow, {
    headerStartRow: range.headerStartRow,
    headerEndRow: range.headerEndRow,
  });
  const columnMap = stabilizeColumnMap(
    body.column_map !== undefined ? sanitizeColumnMap(body.column_map) : sanitizeColumnMap(item.column_map || {}),
    columns,
  );
  const mappingMeta = composeMappingMeta(
    columnMap,
    columns,
    body.mapping_meta !== undefined ? body.mapping_meta : item.mapping_meta || {},
  );
  const check = mappingCheck(columnMap, columns, mappingMeta);
  const status = check.ok && Object.keys(columnMap).length > 0 ? "UPLOADED" : "MAPPING_REQUIRED";

  const updated = await orderImportsRepository.updateImport(item.id, {
    sheet_name: sheetName,
    header_row_number: range.headerEndRow,
    header_start_row: range.headerStartRow,
    header_end_row: range.headerEndRow,
    data_start_row: range.dataStartRow,
    column_map: Object.keys(columnMap).length ? columnMap : null,
    mapping_meta: mappingMeta,
    status,
    error_message: check.ok ? null : "저장된 컬럼을 찾을 수 없습니다.",
  });

  const saveMapping = body.save_mapping !== false;
  if (saveMapping) {
    await excelMappingsRepository.upsertActiveMapping(item.client_id, {
      sheet_name: sheetName,
      header_row_number: range.headerEndRow,
      header_start_row: range.headerStartRow,
      header_end_row: range.headerEndRow,
      data_start_row: range.dataStartRow,
      column_map: columnMap,
      mapping_meta: mappingMeta,
    });
  }

  return withMappingMeta(updated, columns, { suggested_header_range: suggested });
}

export async function acknowledgeDuplicate(idParam) {
  const item = await requireImport(idParam);
  const updated = await orderImportsRepository.updateImport(item.id, {
    duplicate_acknowledged: true,
  });
  return publicImport(updated);
}

export async function parseImport(idParam) {
  const item = await requireImport(idParam);
  await ordersService.assertImportNotConfirmed(item.id);
  await requireActiveClient(item.client_id);
  if (item.duplicate_hash_detected && !item.duplicate_acknowledged) {
    throw new AppError("DUPLICATE_NOT_ACKNOWLEDGED", "중복 파일임을 확인한 뒤 계속 진행할 수 있습니다.", 400);
  }
  const buffer = await readStoredOrderFile(item.stored_file_name);
  const workbook = readWorkbook(buffer);
  const { name: sheetName, sheet } = getSheet(workbook, item.sheet_name);
  const suggested = detectHeaderRange(sheet);
  const range = headerRangeFromRecord(item, suggested);
  const { columns } = headerFromRow(sheet, range.headerEndRow, {
    headerStartRow: range.headerStartRow,
    headerEndRow: range.headerEndRow,
  });
  const columnMap = stabilizeColumnMap(sanitizeColumnMap(item.column_map || {}), columns);
  const missingRequired = requiredMappingMissing(columnMap);
  if (missingRequired.length > 0) {
    throw new AppError("MAPPING_REQUIRED", "상품명과 수량 매핑이 필요합니다.", 400);
  }
  const mappingMeta = composeMappingMeta(columnMap, columns, item.mapping_meta || {});
  const missingColumns = mappingColumnsNotFound(columnMap, columns, mappingMeta);
  if (missingColumns.length > 0) {
    await orderImportsRepository.updateImport(item.id, {
      status: "MAPPING_REQUIRED",
      error_message: "저장된 컬럼을 찾을 수 없습니다.",
    });
    throw new AppError("MAPPING_COLUMNS_NOT_FOUND", "저장된 컬럼을 찾을 수 없습니다.", 400);
  }

  const identifierHeaders = identifierHeadersFromMap(columnMap, columns, mappingMeta);
  const extracted = extractDataRows(sheet, range.headerEndRow, {
    headerStartRow: range.headerStartRow,
    headerEndRow: range.headerEndRow,
    dataStartRow: range.dataStartRow,
    identifierHeaders,
  });
  const aliases = await productAliasesRepository.listAliasesForMatch(item.client_id);
  const products = await orderImportsRepository.listProductsForMatch();
  const matchIndexes = buildMatchIndexes(aliases, products);
  const previousRows = await orderImportsRepository.listImportRows(item.id);
  const parsedRows = applyPreservedManualQuantity(
    extracted.rows
      .filter((row) => !shouldSkipImportRow(row, columnMap, columns, mappingMeta))
      .map((row) => parseOneRow(row, columnMap, matchIndexes, sheetName, columns, mappingMeta)),
    previousRows,
  );
  const summary = summarize(parsedRows);

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await orderImportsRepository.deleteImportRows(item.id, db);
    await orderImportsRepository.insertImportRows(item.id, parsedRows, db);
    const updated = await orderImportsRepository.updateImport(
      item.id,
      {
        ...summary,
        error_message: null,
      },
      db,
    );
    await db.query("COMMIT");
    const savedRows = await orderImportsRepository.listImportRows(item.id);
    return {
      ...withMappingMeta(updated, columns, { suggested_header_range: suggested }),
      items: savedRows,
    };
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // already rolled back
    }
    logger.error("Order import parse failed", err);
    throw err;
  } finally {
    db.release();
  }
}

export async function listRows(idParam) {
  const item = await requireImport(idParam);
  const rows = await orderImportsRepository.listImportRows(item.id);
  return {
    import: publicImport(item),
    items: rows,
  };
}

export async function matchRow(idParam, rowIdParam, body) {
  const item = await requireImport(idParam);
  await ordersService.assertImportNotConfirmed(item.id);
  await requireActiveClient(item.client_id);
  const rowId = parseId(rowIdParam);
  const row = await orderImportsRepository.getImportRow(item.id, rowId);
  if (!row) {
    throw new AppError("IMPORT_ROW_NOT_FOUND", "발주 행을 찾을 수 없습니다.", 404);
  }
  const optionId = parseId(body.product_option_id ?? body.product_id, "INVALID_PRODUCT_OPTION_ID");
  const product = await orderImportsRepository.getOptionById(optionId);
  if (!product) {
    throw new AppError("PRODUCT_NOT_FOUND", "존재하지 않는 상품입니다.", 400);
  }
  if (!product.is_active) {
    throw new AppError("PRODUCT_INACTIVE", "비활성 상품에는 연결할 수 없습니다.", 400);
  }
  const saveAlias = body.save_alias !== false;
  const errors = validationErrorsForRow({
    externalProductName: row.external_product_name,
    externalProductCode: row.external_product_code,
    matchStatus: "MANUAL",
    effectiveQuantity: row.quantity,
  });

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const updatedRow = await orderImportsRepository.updateImportRowMatch(
      item.id,
      rowId,
      {
        matched_product_option_id: product.id,
        match_status: "MANUAL",
        validation_status: errors.length === 0 ? "VALID" : "INVALID",
        validation_errors: errors,
      },
      db,
    );
    if (saveAlias) {
      await productAliasesRepository.upsertAlias(
        {
          client_id: item.client_id,
          external_product_code: row.external_product_code,
          external_product_name: row.external_product_name,
          external_option_name: row.external_option_name,
          normalized_product_code: normalizeAliasText(row.external_product_code),
          normalized_product_name: normalizeAliasText(row.external_product_name),
          normalized_option_name: normalizeAliasText(row.external_option_name),
          product_option_id: product.id,
        },
        db,
      );
    }
    const allRows = await orderImportsRepository.listImportRows(item.id, db);
    const summary = summarize(allRows);
    const updatedImport = await orderImportsRepository.updateImport(item.id, summary, db);
    await db.query("COMMIT");
    return {
      import: publicImport(updatedImport),
      row: updatedRow,
    };
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // already rolled back
    }
    throw err;
  } finally {
    db.release();
  }
}

export async function overrideRowQuantity(idParam, rowIdParam, body) {
  const item = await requireImport(idParam);
  const existingOrder = await ordersRepository.getOrderByImportId(item.id);
  if (existingOrder?.status === "CONFIRMED" || existingOrder?.status === "CANCELLED") {
    throw new AppError("ORDER_IMPORT_CONFIRMED", "확정된 거래의 발주서 수량은 수정할 수 없습니다.", 400);
  }
  await requireActiveClient(item.client_id);
  const rowId = parseId(rowIdParam);
  const row = await orderImportsRepository.getImportRow(item.id, rowId);
  if (!row) {
    throw new AppError("IMPORT_ROW_NOT_FOUND", "발주 행을 찾을 수 없습니다.", 404);
  }

  const reset = body.reset === true || body.quantity === null;
  let qty;
  if (reset) {
    qty = applyEffectiveQuantity({
      parsed_quantity: row.parsed_quantity,
      manual_quantity: null,
    });
  } else {
    const manualQuantity = requiredInt(body.quantity, {
      min: 1,
      code: "INVALID_QUANTITY",
      message: "수량은 1 이상의 정수여야 합니다.",
    });
    qty = applyEffectiveQuantity({
      parsed_quantity: row.parsed_quantity,
      manual_quantity: manualQuantity,
    });
  }

  const errors = validationErrorsForRow({
    externalProductName: row.external_product_name,
    externalProductCode: row.external_product_code,
    matchStatus: row.match_status,
    effectiveQuantity: qty.quantity,
  });

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const updatedRow = await orderImportsRepository.updateImportRowQuantity(
      item.id,
      rowId,
      {
        ...qty,
        validation_status: errors.length === 0 ? "VALID" : "INVALID",
        validation_errors: errors,
      },
      db,
    );
    const allRows = await orderImportsRepository.listImportRows(item.id, db);
    const summary = summarize(allRows);
    const updatedImport = await orderImportsRepository.updateImport(item.id, summary, db);
    await insertAuditLog(
      {
        entity_type: "ORDER_IMPORT_ROW",
        entity_id: rowId,
        action: "QUANTITY_OVERRIDE",
        before_data: {
          import_id: item.id,
          before_quantity: row.quantity,
          after_quantity: qty.quantity,
          parsed_quantity: qty.parsed_quantity,
          manual_quantity: qty.manual_quantity,
          quantity_source: qty.quantity_source,
        },
      },
      db,
    );
    await db.query("COMMIT");
    return {
      import: publicImport(updatedImport),
      row: updatedRow,
    };
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // already rolled back
    }
    throw err;
  } finally {
    db.release();
  }
}

export async function getDeleteImpact(idParam) {
  const item = await requireImport(idParam);
  return { id: item.id, ...await orderImportImpact(item.id) };
}

export async function deleteImport(idParam, query = {}) {
  const item = await requireImport(idParam);
  const impact = await orderImportImpact(item.id);
  const deleteDraft = query.delete_draft === true || query.delete_draft === "true" || query.delete_draft === "1";
  if (impact.references.order_status === "CONFIRMED" || impact.references.order_status === "CANCELLED") {
    throw new AppError("ORDER_IMPORT_CONFIRMED", "확정되었거나 취소된 거래가 연결된 발주서는 삭제할 수 없습니다.", 409, impact.references);
  }
  if (impact.delete_draft_required && !deleteDraft) {
    throw new AppError(
      "ORDER_IMPORT_HAS_DRAFT",
      "연결된 DRAFT 거래가 있습니다. delete_draft=true 로 DRAFT까지 함께 삭제할 수 있습니다.",
      409,
      impact.references,
    );
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    if (impact.references.order_id) {
      await ordersRepository.deleteDraftOrder(impact.references.order_id, db);
    }
    await orderImportsRepository.deleteImportRows(item.id, db);
    await orderImportsRepository.deleteImport(item.id, db);
    await insertAuditLog({
      entity_type: "order_import",
      entity_id: item.id,
      action: "DELETE",
      before_data: {
        id: item.id,
        original_file_name: item.original_file_name,
        stored_file_name: item.stored_file_name,
        status: item.status,
        order_id: impact.references.order_id,
      },
    }, db);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }

  await deleteOrderUploadAfterCommit(item.stored_file_name);
  return { deleted: true, id: item.id, file_deleted: true };
}

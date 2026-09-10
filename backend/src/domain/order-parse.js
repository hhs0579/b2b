import { normalizeAliasText } from "./normalize.js";
import { findMappedColumn } from "./excel-mapping.js";
import { normalizeHeaderName, parseFactor, suggestQuantityFallback } from "./excel-headers.js";

/** 유사도/부분문자열/Levenshtein 자동매칭은 사용하지 않는다. */

export function applyEffectiveQuantity({ parsed_quantity = null, manual_quantity = null } = {}) {
  const quantity = manual_quantity != null ? manual_quantity : parsed_quantity;
  return {
    parsed_quantity,
    manual_quantity,
    quantity,
    quantity_source: manual_quantity != null ? "MANUAL" : "PARSED",
  };
}

export function rowIdentityKey(row) {
  return [
    row.source_sheet_name || "",
    row.source_row_number,
    row.external_product_code || "",
    row.external_product_name || "",
    row.external_option_name || "",
  ].join("\u0001");
}

export function isQuantityError(message) {
  return message === "수량이 없습니다." || message === "수량은 1 이상의 정수여야 합니다.";
}

export function parseQuantity(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: "수량이 없습니다." };
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1) {
      return { ok: false, error: "수량은 1 이상의 정수여야 합니다." };
    }
    return { ok: true, quantity: value };
  }
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    return { ok: false, error: "수량은 1 이상의 정수여야 합니다." };
  }
  return { ok: true, quantity: Number(text) };
}

export function normalizeProductCode(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isSafeInteger(value)) {
      return String(value);
    }
    return String(Math.trunc(value));
  }
  let text = String(value).trim().replace(/,/g, "");
  if (/^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(text)) {
    const parsed = Number(text);
    if (Number.isSafeInteger(parsed)) {
      return String(parsed);
    }
  }
  if (/^\d+\.0+$/.test(text)) {
    text = text.replace(/\.0+$/, "");
  }
  return normalizeAliasText(text);
}

function coerceMapped(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  const text = String(value);
  return text.trim() === "" ? null : text;
}

export function lookupRaw(raw, headerKey, headerColumns = []) {
  if (!headerKey || !raw) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(raw, headerKey) && !isBlankRaw(raw[headerKey])) {
    return raw[headerKey];
  }
  const n = normalizeHeaderName(headerKey);
  const col = findMappedColumn(headerColumns, headerKey);
  if (col) {
    const fromCol = raw[col.excel_col] ?? raw[col.composite_header] ?? raw[col.display_name] ?? raw[col.raw_header];
    if (!isBlankRaw(fromCol)) {
      return fromCol;
    }
  }
  for (const [key, value] of Object.entries(raw)) {
    if (normalizeHeaderName(key) === n && !isBlankRaw(value)) {
      return value;
    }
  }
  return raw[headerKey] ?? null;
}

function isBlankRaw(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function mappedValue(raw, columnMap, field, headerColumns = [], mappingMeta = {}) {
  const column = columnMap[field];
  if (!column) {
    return null;
  }
  const col = findMappedColumn(headerColumns, column, mappingMeta, field);
  if (col) {
    return coerceMapped(
      raw[col.excel_col] ?? raw[col.composite_header] ?? raw[col.display_name] ?? raw[col.raw_header] ?? raw[col.name],
    );
  }
  if (typeof column === "string") {
    return coerceMapped(lookupRaw(raw, column, headerColumns));
  }
  const binding = column && typeof column === "object" ? column.composite_header || column.column_letter : null;
  return coerceMapped(binding ? lookupRaw(raw, binding, headerColumns) : null);
}

export function mappedText(raw, columnMap, field, headerColumns = [], mappingMeta = {}) {
  const value = mappedValue(raw, columnMap, field, headerColumns, mappingMeta);
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function resolveParsedQuantity(raw, columnMap, headerColumns = [], mappingMeta = {}) {
  const primary = parseQuantity(mappedValue(raw, columnMap, "quantity", headerColumns, mappingMeta));
  if (primary.ok) {
    return primary;
  }
  const fallback = mappingMeta?.quantity_fallback || suggestQuantityFallback(headerColumns);
  if (fallback?.op === "MUL" && Array.isArray(fallback.columns) && fallback.columns.length >= 2) {
    const factors = fallback.columns.map((header) => parseFactor(lookupRaw(raw, header, headerColumns)));
    if (factors.every((value) => value != null)) {
      const product = factors.reduce((acc, value) => acc * value, 1);
      if (Number.isInteger(product) && product >= 1) {
        return { ok: true, quantity: product };
      }
    }
  }
  return primary;
}

function inactiveOrMatch(product, matchedStatus) {
  if (!product.is_active) {
    return {
      match_status: "MATCHED_BUT_INACTIVE",
      matched_product_option_id: product.id,
      matched_product_id: product.product_id,
    };
  }
  return {
    match_status: matchedStatus,
    matched_product_option_id: product.id,
    matched_product_id: product.product_id,
  };
}

export function matchProduct({
  aliasesByKey,
  productsByCode,
  productsByBarcode = new Map(),
  productsByNameOption,
  productsByName = new Map(),
  externalProductCode,
  externalProductName,
  externalOptionName,
}) {
  const nCode = normalizeProductCode(externalProductCode);
  const nName = normalizeAliasText(externalProductName);
  const nOption = normalizeAliasText(externalOptionName);
  const aliasKey = `${nCode}|${nName}|${nOption}`;
  const nameOptionKey = `|${nName}|${nOption}`;

  const alias = aliasesByKey.get(aliasKey) || (nName ? aliasesByKey.get(nameOptionKey) : null);
  if (alias) {
    if (!alias.is_active) {
      return {
        match_status: "MATCHED_BUT_INACTIVE",
        matched_product_option_id: alias.product_option_id,
        matched_product_id: alias.product_id,
      };
    }
    return {
      match_status: "MATCHED_ALIAS",
      matched_product_option_id: alias.product_option_id,
      matched_product_id: alias.product_id,
    };
  }

  if (nCode) {
    const product = productsByCode.get(nCode);
    if (product) {
      return inactiveOrMatch(product, "MATCHED_PRODUCT_CODE");
    }
    const byBarcode = productsByBarcode.get(nCode);
    if (byBarcode) {
      return inactiveOrMatch(byBarcode, "MATCHED_BARCODE");
    }
  }

  if (nName) {
    const matches = productsByNameOption.get(`${nName}|${nOption}`) || [];
    if (matches.length === 1) {
      return inactiveOrMatch(matches[0], "MATCHED_EXACT");
    }
    if (!nOption) {
      const byName = productsByName.get(nName) || [];
      if (byName.length === 1) {
        return inactiveOrMatch(byName[0], "MATCHED_EXACT");
      }
    }
  }

  return {
    match_status: "UNMATCHED",
    matched_product_option_id: null,
    matched_product_id: null,
  };
}

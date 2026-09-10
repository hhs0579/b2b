import { normalizeHeaderName } from "./excel-headers.js";

export const MAPPING_FIELDS = [
  { key: "external_product_name", label: "상품명", required: true },
  { key: "external_product_code", label: "상품코드", required: false },
  { key: "external_option_name", label: "옵션", required: false },
  { key: "quantity", label: "수량", required: true },
  { key: "external_order_number", label: "주문번호", required: false },
  { key: "recipient_name", label: "수취인", required: false },
  { key: "phone", label: "연락처", required: false },
  { key: "address", label: "주소", required: false },
  { key: "shipping_memo", label: "배송메모", required: false },
];

const ALLOWED_KEYS = new Set(MAPPING_FIELDS.map((field) => field.key));

const QUANTITY_EXCLUDE = /발주box|발주박스|박스수량|(^|\s)box($|\s)/i;
const QUANTITY_PREFERRED = [
  /^발주\s*\/\s*발주수량$/i,
  /^발주수량$/i,
  /^수량$/i,
  /^주문수량$/i,
];

function asInt(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

export function bindingFromColumn(col) {
  if (!col) {
    return null;
  }
  return {
    column_index: col.column_index,
    column_letter: col.excel_col || col.column_letter,
    raw_header: col.raw_header || col.display_name || col.name || "",
    normalized_header: col.parent_normalized || col.normalized_header || "",
    composite_header: col.composite_header || col.normalized_name || col.display_name || col.name || "",
  };
}

export function normalizeBinding(stored) {
  if (stored == null || stored === "") {
    return null;
  }
  if (typeof stored === "string") {
    const text = stored.trim();
    if (!text) {
      return null;
    }
    return {
      column_index: null,
      column_letter: /^[A-Z]+$/i.test(text) ? text.toUpperCase() : null,
      raw_header: text,
      normalized_header: normalizeHeaderName(text),
      composite_header: text,
    };
  }
  if (typeof stored !== "object" || Array.isArray(stored)) {
    return null;
  }
  const letter = stored.column_letter || stored.columnLetter || null;
  const composite = stored.composite_header || stored.compositeHeader || null;
  const raw = stored.raw_header || stored.rawHeader || null;
  const normalized = stored.normalized_header || stored.normalizedHeader || null;
  const index = asInt(stored.column_index ?? stored.columnIndex);
  if (!letter && composite == null && raw == null && normalized == null && index == null) {
    return null;
  }
  return {
    column_index: index,
    column_letter: letter ? String(letter).toUpperCase() : null,
    raw_header: raw ? String(raw) : null,
    normalized_header: normalized ? String(normalized) : null,
    composite_header: composite ? String(composite) : null,
  };
}

export function sanitizeColumnMap(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const result = {};
  for (const field of MAPPING_FIELDS) {
    const binding = normalizeBinding(input[field.key]);
    if (!binding) {
      continue;
    }
    result[field.key] = binding;
  }
  return result;
}

export function sanitizeMappingMeta(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const result = {};
  const fallback = input.quantity_fallback;
  if (fallback && fallback.op === "MUL" && Array.isArray(fallback.columns)) {
    const columns = fallback.columns.map((value) => String(value).trim()).filter(Boolean);
    if (columns.length >= 2) {
      result.quantity_fallback = { op: "MUL", columns };
    }
  }
  if (input.field_columns && typeof input.field_columns === "object" && !Array.isArray(input.field_columns)) {
    const fieldColumns = {};
    for (const [key, value] of Object.entries(input.field_columns)) {
      if (!ALLOWED_KEYS.has(key) || !value || typeof value !== "object") {
        continue;
      }
      const binding = normalizeBinding(value);
      if (!binding) {
        continue;
      }
      fieldColumns[key] = {
        ...binding,
        header_depth: Number.isInteger(value.header_depth) ? value.header_depth : undefined,
        excel_col: binding.column_letter || value.excel_col,
      };
    }
    if (Object.keys(fieldColumns).length) {
      result.field_columns = fieldColumns;
    }
  }
  return result;
}

export function asHeaderColumns(headers = []) {
  return headers.map((header, offset) => {
    if (header && typeof header === "object") {
      const excelCol = header.excel_col || header.column_letter || null;
      const composite =
        header.composite_header || header.normalized_name || header.display_name || header.name || "";
      return {
        excel_col: excelCol,
        column_index: Number.isInteger(header.column_index) ? header.column_index : offset,
        name: header.name || composite,
        display_name: header.display_name || composite,
        normalized_name: header.normalized_name || composite,
        raw_header: header.raw_header || header.display_name || "",
        composite_header: composite,
        parent_normalized: header.parent_normalized || header.normalized_header || normalizeHeaderName(composite),
        header_depth: header.header_depth,
      };
    }
    const name = String(header ?? "");
    return {
      excel_col: null,
      column_index: offset,
      name,
      display_name: name,
      normalized_name: normalizeHeaderName(name),
      raw_header: name,
      composite_header: normalizeHeaderName(name) || name,
      parent_normalized: normalizeHeaderName(name),
    };
  });
}

function compositeEquals(left, right) {
  if (!left || !right) {
    return false;
  }
  return left === right || normalizeHeaderName(left) === normalizeHeaderName(right);
}

export function findMappedColumn(headerColumns, stored, mappingMeta, field) {
  const columns = asHeaderColumns(headerColumns);
  const binding = normalizeBinding(stored) || normalizeBinding(mappingMeta?.field_columns?.[field]);
  if (!binding || !columns.length) {
    return null;
  }

  if (Number.isInteger(binding.column_index) && binding.composite_header) {
    const hit = columns.find(
      (col) => col.column_index === binding.column_index && compositeEquals(col.composite_header, binding.composite_header),
    );
    if (hit) {
      return hit;
    }
  }
  if (binding.column_letter && binding.composite_header) {
    const hit = columns.find(
      (col) => col.excel_col === binding.column_letter && compositeEquals(col.composite_header, binding.composite_header),
    );
    if (hit) {
      return hit;
    }
  }

  if (binding.composite_header) {
    const hits = columns.filter((col) => compositeEquals(col.composite_header, binding.composite_header));
    if (hits.length === 1) {
      return hits[0];
    }
  }

  if (binding.raw_header) {
    const hits = columns.filter(
      (col) => col.raw_header === binding.raw_header || col.display_name === binding.raw_header,
    );
    if (hits.length === 1) {
      return hits[0];
    }
  }

  if (binding.column_letter) {
    const hits = columns.filter((col) => col.excel_col === binding.column_letter);
    if (hits.length === 1) {
      return hits[0];
    }
  }
  if (Number.isInteger(binding.column_index)) {
    const hits = columns.filter((col) => col.column_index === binding.column_index);
    if (hits.length === 1) {
      return hits[0];
    }
  }

  const normalized = binding.normalized_header || (binding.composite_header ? normalizeHeaderName(binding.composite_header) : "");
  if (normalized) {
    const hits = columns.filter((col) => {
      return (
        col.composite_header === normalized ||
        col.parent_normalized === normalized ||
        col.normalized_name === normalized ||
        normalizeHeaderName(col.composite_header) === normalized
      );
    });
    if (hits.length === 1) {
      return hits[0];
    }
  }

  return null;
}

export function stabilizeColumnMap(columnMap, headerColumns) {
  const result = {};
  for (const [field, stored] of Object.entries(columnMap || {})) {
    const col = findMappedColumn(headerColumns, stored);
    if (col) {
      result[field] = bindingFromColumn(col);
    }
  }
  return dedupeColumnMap(result);
}

export function dedupeColumnMap(columnMap) {
  const used = new Set();
  const result = {};
  for (const field of MAPPING_FIELDS.map((item) => item.key)) {
    const binding = columnMap[field];
    if (!binding) {
      continue;
    }
    const letter = binding.column_letter;
    if (letter && used.has(letter)) {
      continue;
    }
    if (letter) {
      used.add(letter);
    }
    result[field] = binding;
  }
  return result;
}

export function buildFieldColumnsMeta(columnMap, headerColumns) {
  const result = {};
  for (const [field, stored] of Object.entries(columnMap || {})) {
    const col = findMappedColumn(headerColumns, stored);
    if (!col) {
      continue;
    }
    result[field] = {
      ...bindingFromColumn(col),
      excel_col: col.excel_col,
      header_depth: col.header_depth,
    };
  }
  return result;
}

export function requiredMappingMissing(columnMap) {
  return MAPPING_FIELDS.filter((field) => field.required).filter((field) => !normalizeBinding(columnMap[field.key])).map(
    (field) => field.key,
  );
}

export function mappingColumnsNotFound(columnMap, headers, mappingMeta = {}) {
  const headerColumns = asHeaderColumns(headers);
  const missing = [];
  for (const [key, column] of Object.entries(columnMap)) {
    if (!ALLOWED_KEYS.has(key) || !column) {
      continue;
    }
    if (!findMappedColumn(headerColumns, column, mappingMeta, key)) {
      const binding = normalizeBinding(column);
      missing.push(binding?.composite_header || binding?.column_letter || binding?.normalized_header || key);
    }
  }
  return missing;
}

export function mappedFieldForColumn(columnMap, col) {
  for (const [field, stored] of Object.entries(columnMap || {})) {
    const binding = normalizeBinding(stored);
    if (!binding) {
      continue;
    }
    if (binding.column_letter && col.excel_col && binding.column_letter === col.excel_col) {
      return field;
    }
    if (Number.isInteger(binding.column_index) && Number.isInteger(col.column_index) && binding.column_index === col.column_index) {
      return field;
    }
  }
  return null;
}

function isQuantityExcluded(col) {
  const text = `${col.composite_header || ""} ${col.raw_header || ""}`;
  return QUANTITY_EXCLUDE.test(text.replace(/\s/g, ""));
}

export function suggestQuantityColumn(headerColumns) {
  const columns = asHeaderColumns(headerColumns).filter((col) => !isQuantityExcluded(col));
  for (const pattern of QUANTITY_PREFERRED) {
    const hits = columns.filter((col) => pattern.test(String(col.composite_header || "").trim()));
    if (hits.length === 1) {
      return hits[0];
    }
  }
  return null;
}

export function suggestColumnMap(headerColumns, existing = {}) {
  const columns = asHeaderColumns(headerColumns);
  const result = { ...sanitizeColumnMap(existing) };
  const uniqueByComposite = (names) => {
    const wanted = new Set(names);
    const hits = columns.filter((col) => wanted.has(col.composite_header));
    return hits.length === 1 ? hits[0] : null;
  };
  if (!result.external_product_name) {
    const col = uniqueByComposite(["상품명"]);
    if (col) {
      result.external_product_name = bindingFromColumn(col);
    }
  }
  if (!result.external_product_code) {
    const col = uniqueByComposite(["상품코드"]);
    if (col) {
      result.external_product_code = bindingFromColumn(col);
    }
  }
  if (!result.quantity) {
    const col = suggestQuantityColumn(columns);
    if (col) {
      result.quantity = bindingFromColumn(col);
    }
  }
  if (!result.address) {
    const col = uniqueByComposite(["입고지", "주소"]);
    if (col) {
      result.address = bindingFromColumn(col);
    }
  }
  if (!result.shipping_memo) {
    const col = uniqueByComposite(["비고", "배송메모", "배송메세지"]);
    if (col) {
      result.shipping_memo = bindingFromColumn(col);
    }
  }
  return stabilizeColumnMap(result, columns);
}

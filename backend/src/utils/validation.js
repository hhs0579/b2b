import { AppError } from "./app-error.js";

export const VAT_TYPES = ["INCLUDED", "EXCLUDED", "ZERO"];
export const SHIPPING_TYPES = ["PARCEL", "FREE", "COLLECT", "TRUCK", "MANUAL"];
export const SHIPPING_CALC_MODES = ["TOTAL_QUANTITY", "PER_ORDER", "PER_ADDRESS"];
export const SETTLEMENT_TYPES = ["PREPAID", "POSTPAID", "OTHER"];

export function requiredText(value, code, message) {
  if (value == null) {
    throw new AppError(code, message, 400);
  }
  const text = String(value).trim();
  if (!text) {
    throw new AppError(code, message, 400);
  }
  return text;
}

export function optionalText(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function requiredBoolean(value, code, message) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new AppError(code, message, 400);
}

export function optionalBooleanQuery(value) {
  if (value == null || value === "") {
    return undefined;
  }
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  throw new AppError("INVALID_IS_ACTIVE", "is_active는 true 또는 false여야 합니다.", 400);
}

export function requiredInt(value, { min, code, message }) {
  let parsed = value;
  if (typeof parsed === "string" && /^-?\d+$/.test(parsed.trim())) {
    parsed = Number(parsed.trim());
  }
  if (!Number.isInteger(parsed)) {
    throw new AppError(code, message, 400);
  }
  if (min !== undefined && parsed < min) {
    throw new AppError(code, message, 400);
  }
  return parsed;
}

export function parseId(value, code = "INVALID_ID") {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new AppError(code, "유효하지 않은 ID입니다.", 400);
}

export function optionalIdQuery(value) {
  if (value == null || value === "") {
    return undefined;
  }
  return parseId(value, "INVALID_SUPPLIER_ID");
}

export function oneOf(value, allowed, code, message) {
  const text = requiredText(value, code, message);
  if (!allowed.includes(text)) {
    throw new AppError(code, message, 400);
  }
  return text;
}

export function paginationFromQuery(query) {
  const page = query.page == null || query.page === "" ? 1 : requiredInt(query.page, {
    min: 1,
    code: "INVALID_PAGE",
    message: "page는 1 이상의 정수여야 합니다.",
  });
  const requestedLimit = query.limit == null || query.limit === "" ? 50 : requiredInt(query.limit, {
    min: 1,
    code: "INVALID_LIMIT",
    message: "limit는 1 이상의 정수여야 합니다.",
  });
  const limit = Math.min(requestedLimit, 200);
  return { page, limit, offset: (page - 1) * limit };
}

export function toPublicId(value) {
  return Number(value);
}

export function optionalDate(value, code = "INVALID_DATE", message = "날짜 형식이 YYYY-MM-DD 이어야 합니다.") {
  if (value == null || value === "") {
    return null;
  }
  return requiredDate(value, code, message);
}

export function requiredDate(value, code = "INVALID_DATE", message = "날짜 형식이 YYYY-MM-DD 이어야 합니다.") {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new AppError(code, message, 400);
  }
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new AppError(code, message, 400);
  }
  return text;
}

export function optionalNonNegativeIntOrNull(value, { code, message }) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requiredInt(value, { min: 0, code, message });
}

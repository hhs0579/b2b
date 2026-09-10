import { invoiceShippingMethodDefault } from "./shipping-config.js";
import { parseIsoDateParts } from "./dates.js";

export const INVOICE_SHIPPING_METHOD_DEFAULTS = Object.freeze({
  PARCEL: "택배출고",
  TRUCK: "용차출고",
  COLLECT: "착불",
  FREE: "무료배송",
  MANUAL: "수동배송",
});

const WEEKDAYS_KO = Object.freeze(["일", "월", "화", "수", "목", "금", "토"]);

export function shippingMethodDefault(shippingType) {
  return INVOICE_SHIPPING_METHOD_DEFAULTS[shippingType] || "";
}

export function formatInvoiceShipDate(isoDate) {
  if (!isoDate) {
    return "";
  }
  const { year, month, day } = parseIsoDateParts(isoDate);
  const weekday = WEEKDAYS_KO[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${String(year).slice(-2)}/${month}/${day}(${weekday})`;
}

export function formatWonAmount(value) {
  return Number(value).toLocaleString("ko-KR");
}

export function formatProductParcelNote(unitPrice, cartonCount) {
  return `${formatWonAmount(unitPrice)}원 × ${cartonCount}`;
}

export function productInvoiceNote(shippingType, { shippingFeePerCarton = 0, cartonCount = 0 } = {}) {
  if (shippingType === "PARCEL") {
    return formatProductParcelNote(shippingFeePerCarton, cartonCount);
  }
  if (shippingType === "TRUCK") {
    return "용차출고";
  }
  if (shippingType === "FREE") {
    return "무료배송";
  }
  if (shippingType === "COLLECT") {
    return "착불";
  }
  if (shippingType === "MANUAL") {
    return "수동배송";
  }
  return "";
}

export function formatInvoiceNoteText(memo = {}) {
  const method = memo.shipping_method ? ` ${memo.shipping_method}` : "";
  const shipDate = memo.formatted_ship_date || formatInvoiceShipDate(memo.ship_date);
  const datePart = shipDate ? ` ${shipDate}` : "";
  const destination = memo.destination ? ` ${memo.destination}` : "";
  const manager = memo.manager ? ` ${memo.manager}` : "";
  return [`배송방법 :${method}`, `출고일 :${datePart}`, `배송지 :${destination}`, `담당자 :${manager}`].join("\n");
}

export function uniqueAddresses(items = []) {
  return [...new Set(items.map((item) => String(item?.address || "").trim()).filter(Boolean))];
}

export function suggestInvoiceMemo({ shippingType, shippingTypes, orderDate, shippedDate, addresses, managerName }) {
  const unique = Array.isArray(addresses) ? addresses : uniqueAddresses(addresses);
  const types = Array.isArray(shippingTypes) && shippingTypes.length ? shippingTypes : [shippingType];
  return {
    shipping_method: invoiceShippingMethodDefault(types) || shippingMethodDefault(shippingType) || null,
    ship_date: shippedDate || orderDate || null,
    destination: unique.length === 1 ? unique[0] : unique.length > 1 ? "다수 배송지" : null,
    manager: managerName || null,
  };
}

export function resolvedInvoiceMemo(order = {}) {
  return {
    shipping_method: order.invoice_shipping_method || null,
    ship_date: order.invoice_ship_date || null,
    destination: order.invoice_destination || null,
    manager: order.invoice_manager || null,
  };
}

export function invoiceMemoWarnings(memo = {}) {
  const warnings = [];
  if (!memo.shipping_method) {
    warnings.push({ field: "shipping_method", message: "배송방법 정보가 비어 있습니다." });
  }
  if (!memo.ship_date) {
    warnings.push({ field: "ship_date", message: "출고일 정보가 비어 있습니다." });
  }
  if (!memo.destination) {
    warnings.push({ field: "destination", message: "배송지 정보가 비어 있습니다." });
  }
  if (!memo.manager) {
    warnings.push({ field: "manager", message: "담당자 정보가 비어 있습니다." });
  }
  return warnings;
}

export function invoiceMemoSnapshot(memo = {}) {
  return {
    shipping_method: memo.shipping_method || "",
    ship_date: memo.ship_date || "",
    destination: memo.destination || "",
    manager: memo.manager || "",
  };
}

export function buildInvoiceMemoView(order, { items = [], client = null, shippingGroups = [] } = {}) {
  const saved = resolvedInvoiceMemo(order);
  const shippingTypes = [...new Set((shippingGroups || []).map((group) => group.shipping_type || order.shipping_type).filter(Boolean))];
  const defaults = suggestInvoiceMemo({
    shippingType: order.shipping_type,
    shippingTypes: shippingTypes.length ? shippingTypes : [order.shipping_type],
    orderDate: order.order_date,
    shippedDate: order.shipped_date || null,
    addresses: uniqueAddresses(items),
    managerName: client?.manager_name || null,
  });
  const suggested = {
    shipping_method: saved.shipping_method ?? defaults.shipping_method,
    ship_date: saved.ship_date ?? defaults.ship_date,
    destination: saved.destination ?? defaults.destination,
    manager: saved.manager ?? defaults.manager,
  };
  return {
    invoice_memo: saved,
    invoice_memo_defaults: defaults,
    invoice_note_preview: formatInvoiceNoteText(saved),
    invoice_note_suggested_preview: formatInvoiceNoteText(suggested),
    invoice_memo_warnings: invoiceMemoWarnings(saved),
    formatted_ship_date: formatInvoiceShipDate(saved.ship_date),
  };
}

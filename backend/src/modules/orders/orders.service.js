import { pool } from "../../db/pool.js";
import { AppError } from "../../utils/app-error.js";
import { logger } from "../../utils/logger.js";
import {
  SHIPPING_CALC_MODES,
  SHIPPING_TYPES,
  oneOf,
  optionalDate,
  optionalNonNegativeIntOrNull,
  optionalText,
  paginationFromQuery,
  parseId,
  requiredDate,
} from "../../utils/validation.js";
import { calculateOrderPreview, previewSignature } from "../../domain/order-calc.js";
import { projectInvoiceLines } from "../../domain/invoice-projection.js";
import { buildInvoiceMemoView, formatInvoiceNoteText, suggestInvoiceMemo, uniqueAddresses } from "../../domain/invoice-note.js";
import {
  applyAllGroupsConfig,
  emptyShippingConfig,
  hasGroupOverrides,
  hydrateSnapshotGroups,
  normalizeShippingConfig,
  parseShippingConfig,
  summarizeShipping,
} from "../../domain/shipping-config.js";
import * as salesClientsRepository from "../sales-clients/sales-clients.repository.js";
import * as orderImportsRepository from "../order-imports/order-imports.repository.js";
import * as clientPricesRepository from "../client-prices/client-prices.repository.js";
import * as ordersRepository from "./orders.repository.js";
import { insertInitialSettlement, listPayments } from "../settlements/settlements.repository.js";
import * as invoicesRepository from "../invoices/invoices.repository.js";
import { insertAuditLog } from "../audit/audit.repository.js";
import { orderImpact } from "../deletions/impact.repository.js";
import { deleteOrderUploadAfterCommit } from "../../utils/storage-cleanup.js";

function settingsFromOrder(order) {
  return {
    shipping_type: order.shipping_type,
    shipping_calculation_mode: order.shipping_calculation_mode,
    manual_shipping_charge: order.manual_shipping_charge,
    shipping_config: parseShippingConfig(order.shipping_config),
  };
}

async function loadLivePreview(order, db = pool) {
  const client = await salesClientsRepository.getSalesClientById(order.client_id, db);
  const importRow = await orderImportsRepository.getImportById(order.order_import_id, db);
  const rows = (await orderImportsRepository.listImportRows(order.order_import_id, db)).filter(
    (row) => row.validation_status === "VALID" && row.matched_product_option_id,
  );
  const optionIds = [...new Set(rows.map((row) => row.matched_product_option_id))];
  const products = await ordersRepository.listOptionsByIds(optionIds, db);
  const productsById = new Map(products.map((item) => [item.id, item]));
  const pricesByProductId = new Map();
  for (const optionId of optionIds) {
    const price = await clientPricesRepository.findEffectivePriceRow(
      order.client_id,
      optionId,
      order.order_date,
      db,
    );
    if (price) {
      pricesByProductId.set(optionId, price);
    }
  }
  const settings = settingsFromOrder(order);
  const calculated = calculateOrderPreview({
    rows,
    productsById,
    pricesByProductId,
    settings,
  });
  if (client && !client.is_active) {
    calculated.blocking_errors.push({
      code: "CLIENT_INACTIVE",
      message: "비활성 매출처의 발주는 확정할 수 없습니다.",
    });
    calculated.can_confirm = false;
  }
  if (importRow?.status !== "READY") {
    calculated.blocking_errors.push({
      code: "IMPORT_NOT_READY",
      message: "발주서가 READY 상태가 아닙니다.",
    });
    calculated.can_confirm = false;
  }
  const signature = previewSignature(calculated, settings);
  return {
    order,
    client,
    import: importRow
      ? {
          id: importRow.id,
          status: importRow.status,
          original_file_name: importRow.original_file_name,
        }
      : null,
    settings: {
      ...settings,
      has_group_overrides: hasGroupOverrides(settings.shipping_config),
    },
    ...calculated,
    calculation_signature: signature,
    snapshot: false,
  };
}

function invoiceFromSnapshots(order, items, groups) {
  const settings = settingsFromOrder(order);
  const shippingGroups = hydrateSnapshotGroups(groups, order.shipping_type);
  const summary = summarizeShipping(shippingGroups, settings);
  return projectInvoiceLines({
    shippingType: order.shipping_type,
    manualCharge: order.manual_shipping_charge,
    items,
    shippingGroups,
    truckGroups: settings.shipping_config.truck_groups,
    truckCharge: summary.truck_shipping_charge,
    manualChargeTotal: summary.manual_shipping_charge,
  });
}

async function loadSnapshotPreview(order) {
  const items = await ordersRepository.listOrderItems(order.id);
  const rawGroups = await ordersRepository.listShippingGroups(order.id);
  const shipping_groups = hydrateSnapshotGroups(rawGroups, order.shipping_type).map((group) => ({
    ...group,
    group_label: group.group_key === "TOTAL" ? "전체 수량" : group.group_key,
  }));
  const settings = settingsFromOrder(order);
  const shippingSummary = summarizeShipping(shipping_groups, settings);
  const { invoice_product_lines, invoice_shipping_lines } = invoiceFromSnapshots(order, items, rawGroups);
  const productAgg = new Map();
  for (const item of items) {
    const existing = productAgg.get(item.product_option_id);
    if (existing) {
      existing.total_quantity += item.quantity;
      existing.product_sales_amount += item.product_sales_amount;
      existing.product_cost_amount += item.product_cost_amount;
      existing.product_margin_amount += item.product_margin_amount;
    } else {
      productAgg.set(item.product_option_id, {
        product_id: item.product_id,
        product_option_id: item.product_option_id,
        product_code: item.product_code,
        product_name: item.product_name,
        option_name: item.option_name,
        purchase_price: item.purchase_price,
        sale_price: item.sale_price,
        total_quantity: item.quantity,
        carton_qty: item.carton_qty,
        shipping_fee_per_carton: item.shipping_fee_per_carton,
        shipping_fee_source: item.shipping_fee_source,
        product_sales_amount: item.product_sales_amount,
        product_cost_amount: item.product_cost_amount,
        product_margin_amount: item.product_margin_amount,
      });
    }
  }
  const cartonByProduct = new Map();
  const parcelChargeByProduct = new Map();
  for (const group of shipping_groups) {
    cartonByProduct.set(group.product_option_id, (cartonByProduct.get(group.product_option_id) || 0) + group.carton_count);
    if (group.shipping_type === "PARCEL") {
      parcelChargeByProduct.set(
        group.product_option_id,
        (parcelChargeByProduct.get(group.product_option_id) || 0) + group.shipping_charge,
      );
    }
  }
  const product_totals = [...productAgg.values()].map((row) => ({
    ...row,
    carton_count: cartonByProduct.get(row.product_option_id) || 0,
    shipping_charge: parcelChargeByProduct.get(row.product_option_id) || 0,
    product_margin_rate: row.product_sales_amount > 0
      ? Math.round((row.product_margin_amount * 10000) / row.product_sales_amount) / 100
      : 0,
  }));
  const warnings = product_totals
    .filter((row) => row.product_margin_amount < 0)
    .map((row) => ({
      code: "NEGATIVE_MARGIN",
      message: `${row.product_name}: 상품마진 ${row.product_margin_amount}원`,
      product_id: row.product_id,
    }));
  return {
    order,
    settings: {
      ...settings,
      has_group_overrides: hasGroupOverrides(settings.shipping_config),
    },
    blocking_errors: [],
    warnings,
    can_confirm: false,
    items,
    product_totals,
    shipping_groups,
    shipping_summary: shippingSummary,
    invoice_product_lines,
    invoice_shipping_lines,
    totals: {
      product_count: product_totals.length,
      total_quantity: order.total_quantity,
      total_cartons: shipping_groups.reduce((sum, group) => sum + group.carton_count, 0),
      total_product_sales: order.total_product_sales,
      total_product_cost: order.total_product_cost,
      total_product_margin: order.total_product_margin,
      total_product_margin_rate: order.total_product_margin_rate,
      total_shipping_charge: order.total_shipping_charge,
      parcel_shipping_charge: shippingSummary.parcel_shipping_charge,
      truck_shipping_charge: shippingSummary.truck_shipping_charge,
      manual_shipping_charge_total: shippingSummary.manual_shipping_charge,
      total_invoice_amount: order.total_invoice_amount,
      invoice_product_line_count: order.invoice_product_line_count,
      invoice_shipping_line_count: order.invoice_shipping_line_count,
      invoice_required_line_count: order.invoice_required_line_count,
      negative_margin_count: warnings.length,
    },
    calculation_signature: order.preview_signature,
    snapshot: true,
  };
}

export async function assertImportNotConfirmed(importId, db = pool) {
  const existing = await ordersRepository.getOrderByImportId(importId, db);
  if (existing?.status === "CONFIRMED" || existing?.status === "CANCELLED") {
    throw new AppError("ORDER_CONFIRMED", "확정된 거래의 발주서는 다시 분석하거나 매칭을 변경할 수 없습니다.", 400);
  }
  return existing;
}

export async function createDraftFromImport(importIdParam) {
  const importId = parseId(importIdParam);
  const item = await orderImportsRepository.getImportById(importId);
  if (!item) {
    throw new AppError("IMPORT_NOT_FOUND", "발주서 업로드를 찾을 수 없습니다.", 404);
  }
  if (item.status !== "READY") {
    throw new AppError("IMPORT_NOT_READY", "READY 상태의 발주서만 거래를 준비할 수 있습니다.", 400);
  }
  const existing = await ordersRepository.getOrderByImportId(importId);
  if (existing) {
    return existing;
  }
  const client = await salesClientsRepository.getSalesClientById(item.client_id);
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  if (!client.is_active) {
    throw new AppError("CLIENT_INACTIVE", "비활성 매출처의 발주는 거래를 준비할 수 없습니다.", 400);
  }
  return ordersRepository.insertDraft({
    order_import_id: item.id,
    client_id: item.client_id,
    order_date: item.order_date,
    shipping_type: client.default_shipping_type,
    shipping_calculation_mode: client.shipping_calculation_mode,
    manual_shipping_charge: null,
  });
}

export async function getPreview(orderIdParam) {
  const order = await ordersRepository.getOrderById(parseId(orderIdParam));
  if (!order) {
    throw new AppError("ORDER_NOT_FOUND", "발주 거래를 찾을 수 없습니다.", 404);
  }
  if (order.status === "CONFIRMED" || order.status === "CANCELLED") {
    const snapshot = await loadSnapshotPreview(order);
    const client = await salesClientsRepository.getSalesClientById(order.client_id);
    const items = await ordersRepository.listOrderItems(order.id);
    return { ...snapshot, ...buildInvoiceMemoView(order, { items, client, shippingGroups: snapshot.shipping_groups }) };
  }
  return loadLivePreview(order);
}

export async function updateSettings(orderIdParam, body) {
  const order = await ordersRepository.getOrderById(parseId(orderIdParam));
  if (!order) {
    throw new AppError("ORDER_NOT_FOUND", "발주 거래를 찾을 수 없습니다.", 404);
  }
  if (order.status !== "DRAFT") {
    throw new AppError("ORDER_NOT_DRAFT", "확정된 거래의 배송 설정은 변경할 수 없습니다.", 400);
  }
  const shippingType = oneOf(
    body.shipping_type ?? order.shipping_type,
    SHIPPING_TYPES,
    "INVALID_SHIPPING_TYPE",
    "배송방식이 올바르지 않습니다.",
  );
  const mode = oneOf(
    body.shipping_calculation_mode ?? order.shipping_calculation_mode,
    SHIPPING_CALC_MODES,
    "INVALID_SHIPPING_CALC_MODE",
    "배송비 계산 방식이 올바르지 않습니다.",
  );
  const usesManual = shippingType === "TRUCK" || shippingType === "MANUAL";
  const manual = usesManual
    ? body.manual_shipping_charge === undefined
      ? order.manual_shipping_charge
      : optionalNonNegativeIntOrNull(body.manual_shipping_charge, {
          code: "INVALID_MANUAL_SHIPPING_CHARGE",
          message: "수동 배송비는 비우거나 0 이상의 정수여야 합니다.",
        })
    : null;

  let shippingConfig = parseShippingConfig(order.shipping_config);
  if (body.apply_all_groups === true) {
    if (shippingType === "TRUCK") {
      const basePreview = await loadLivePreview({ ...order, shipping_config: emptyShippingConfig() });
      shippingConfig = applyAllGroupsConfig(basePreview.shipping_groups, shippingType, manual, order.shipping_config);
    } else {
      shippingConfig = emptyShippingConfig();
    }
  } else if (body.shipping_config !== undefined) {
    const normalized = normalizeShippingConfig(body.shipping_config);
    if (normalized.errors.length) {
      throw new AppError(normalized.errors[0].code, normalized.errors[0].message, 400);
    }
    shippingConfig = normalized.config;
  }

  const updated = await ordersRepository.updateSettings(order.id, {
    shipping_type: shippingType,
    shipping_calculation_mode: mode,
    manual_shipping_charge: manual,
    shipping_config: shippingConfig,
  });
  return loadLivePreview(updated);
}

export async function updateInvoiceMemo(orderIdParam, body = {}) {
  const order = await ordersRepository.getOrderById(parseId(orderIdParam));
  if (!order) {
    throw new AppError("ORDER_NOT_FOUND", "거래를 찾을 수 없습니다.", 404);
  }
  if (order.status !== "CONFIRMED") {
    throw new AppError("ORDER_NOT_CONFIRMED", "확정된 거래만 거래명세서 특이사항을 수정할 수 있습니다.", 400);
  }
  const memo = {
    shipping_method: optionalText(body.invoice_shipping_method ?? body.shipping_method),
    ship_date: optionalDate(body.invoice_ship_date ?? body.ship_date, "INVALID_INVOICE_SHIP_DATE", "출고일 형식이 YYYY-MM-DD 이어야 합니다."),
    destination: optionalText(body.invoice_destination ?? body.destination),
    manager: optionalText(body.invoice_manager ?? body.manager),
  };
  const updated = await ordersRepository.updateInvoiceMemo(order.id, {
    invoice_shipping_method: memo.shipping_method,
    invoice_ship_date: memo.ship_date,
    invoice_destination: memo.destination,
    invoice_manager: memo.manager,
    invoice_note: formatInvoiceNoteText(memo),
  });
  const items = await ordersRepository.listOrderItems(order.id);
  const groups = await ordersRepository.listShippingGroups(order.id);
  const client = await salesClientsRepository.getSalesClientById(order.client_id);
  return {
    order: updated,
    ...invoiceFromSnapshots(updated, items, groups),
    ...buildInvoiceMemoView(updated, { items, client, shippingGroups: hydrateSnapshotGroups(groups, updated.shipping_type) }),
  };
}

export async function confirmOrder(orderIdParam, body = {}) {
  const orderId = parseId(orderIdParam);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const locked = await ordersRepository.lockOrder(orderId, db);
    if (!locked) {
      throw new AppError("ORDER_NOT_FOUND", "발주 거래를 찾을 수 없습니다.", 404);
    }
    if (locked.status !== "DRAFT") {
      throw new AppError("ORDER_NOT_DRAFT", "DRAFT 상태의 거래만 확정할 수 있습니다.", 400);
    }
    const order = await ordersRepository.getOrderById(orderId, db);
    const preview = await loadLivePreview(order, db);
    if (body.preview_signature && body.preview_signature !== preview.calculation_signature) {
      throw new AppError("ORDER_PREVIEW_CHANGED", "Preview 이후 가격 또는 원가가 변경되었습니다. 다시 계산한 뒤 확정하세요.", 409);
    }
    if (!preview.can_confirm) {
      const first = preview.blocking_errors[0];
      throw new AppError(first?.code || "ORDER_CONFIRM_BLOCKED", first?.message || "발주를 확정할 수 없습니다.", 400);
    }

    const clientNameSnapshot = String(preview.client?.client_name || "").trim();
    if (!clientNameSnapshot) {
      throw new AppError("CLIENT_NAME_REQUIRED", "확정 시 매출처명을 저장할 수 없습니다.", 400);
    }
    await ordersRepository.insertOrderItems(orderId, preview.items, db);
    await ordersRepository.insertShippingGroups(orderId, preview.shipping_groups, db);
    await ordersRepository.confirmOrder(
      orderId,
      preview.totals,
      preview.calculation_signature,
      clientNameSnapshot,
      db,
    );
    if (!order.invoice_shipping_method) {
      const suggested = suggestInvoiceMemo({
        shippingType: order.shipping_type,
        shippingTypes: preview.shipping_summary?.types,
        orderDate: order.order_date,
        addresses: uniqueAddresses(preview.items),
        managerName: preview.client?.manager_name || null,
      });
      await ordersRepository.updateInvoiceMemo(
        orderId,
        {
          invoice_shipping_method: suggested.shipping_method,
          invoice_ship_date: suggested.ship_date,
          invoice_destination: suggested.destination,
          invoice_manager: suggested.manager,
          invoice_note: formatInvoiceNoteText(suggested),
        },
        db,
      );
    }
    await insertInitialSettlement(orderId, preview.totals.total_invoice_amount, db);
    await db.query("COMMIT");
    const latest = await ordersRepository.getOrderById(orderId);
    const snapshot = await loadSnapshotPreview(latest);
    const client = await salesClientsRepository.getSalesClientById(latest.client_id);
    return {
      ...snapshot,
      ...buildInvoiceMemoView(latest, { items: snapshot.items, client, shippingGroups: snapshot.shipping_groups }),
    };
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // already rolled back
    }
    if (!(err instanceof AppError)) {
      logger.error("Order confirm failed", err);
    }
    throw err;
  } finally {
    db.release();
  }
}

export async function listLedger(query = {}) {
  const { page, limit, offset } = paginationFromQuery(query);
  const from = query.from ? requiredDate(query.from) : undefined;
  const to = query.to ? requiredDate(query.to) : undefined;
  const clientId = query.client_id ? parseId(query.client_id) : undefined;
  const productId = query.product_id ? parseId(query.product_id) : undefined;
  const orderNumber = optionalText(query.order_number || query.q);
  let settlementStatuses;
  if (query.settlement_status) {
    settlementStatuses = String(query.settlement_status)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const status of settlementStatuses) {
      if (!["UNPAID", "PARTIAL", "PAID"].includes(status)) {
        throw new AppError("INVALID_SETTLEMENT_STATUS", "정산상태가 올바르지 않습니다.", 400);
      }
    }
  }
  const sort = query.sort === "expected_asc" ? "expected_asc" : "date_desc";
  const result = await ordersRepository.listConfirmedOrders({
    from,
    to,
    clientId,
    productId,
    orderNumber,
    settlementStatuses,
    sort,
    limit,
    offset,
  });
  return { items: result.items, total: result.total, page, limit };
}

export async function getLedgerDetail(orderIdParam) {
  const orderId = parseId(orderIdParam);
  const order = await ordersRepository.getConfirmedLedger(orderId);
  if (!order) {
    throw new AppError("ORDER_NOT_FOUND", "거래를 찾을 수 없습니다.", 404);
  }
  if (order.status !== "CONFIRMED" && order.status !== "CANCELLED") {
    throw new AppError("ORDER_NOT_CONFIRMED", "확정된 거래만 거래 상세에서 조회합니다.", 400);
  }
  const items = await ordersRepository.listOrderItems(orderId);
  const shipping_groups = await ordersRepository.listShippingGroups(orderId);
  const documents = await invoicesRepository.listByOrderId(orderId);
  const payments = order.settlement_id ? await listPayments(order.settlement_id) : [];
  const client = await salesClientsRepository.getSalesClientById(order.client_id);
  const projection = invoiceFromSnapshots(order, items, shipping_groups);
  return {
    order,
    items,
    shipping_groups,
    documents,
    invoice_product_lines: projection.invoice_product_lines,
    invoice_shipping_lines: projection.invoice_shipping_lines,
    ...buildInvoiceMemoView(order, { items, client, shippingGroups: hydrateSnapshotGroups(shipping_groups, order.shipping_type) }),
    payments,
    settlement: order.settlement_id
      ? {
          id: order.settlement_id,
          billing_amount: order.billing_amount,
          paid_amount: order.paid_amount,
          outstanding_amount: order.outstanding_amount,
          settlement_status: order.settlement_status,
          expected_payment_date: order.expected_payment_date,
          last_payment_date: order.last_payment_date,
          tax_invoice_status: order.tax_invoice_status,
          tax_invoice_issued_at: order.tax_invoice_issued_at,
          memo: order.settlement_memo,
        }
      : null,
  };
}

export async function getDeleteImpact(orderIdParam) {
  const order = await ordersRepository.getOrderById(parseId(orderIdParam));
  if (!order) {
    throw new AppError("ORDER_NOT_FOUND", "거래를 찾을 수 없습니다.", 404);
  }
  return { id: order.id, ...await orderImpact(order.id) };
}

export async function deleteDraftOrder(orderIdParam, query = {}) {
  const orderId = parseId(orderIdParam);
  const order = await ordersRepository.getOrderById(orderId);
  if (!order) {
    throw new AppError("ORDER_NOT_FOUND", "거래를 찾을 수 없습니다.", 404);
  }
  if (order.status === "CONFIRMED" || order.status === "CANCELLED") {
    throw new AppError("ORDER_NOT_DELETABLE", "확정된 거래는 삭제할 수 없습니다. 거래 취소를 사용하세요.", 409);
  }
  if (order.status !== "DRAFT") {
    throw new AppError("ORDER_NOT_DRAFT", "DRAFT 거래만 삭제할 수 있습니다.", 400);
  }
  const keepImport = !(query.keep_import === false || query.keep_import === "false" || query.keep_import === "0");
  const importRow = await orderImportsRepository.getImportById(order.order_import_id);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const deleted = await ordersRepository.deleteDraftOrder(orderId, db);
    if (!deleted) {
      throw new AppError("ORDER_NOT_DRAFT", "DRAFT 거래만 삭제할 수 있습니다.", 400);
    }
    if (!keepImport && importRow) {
      await orderImportsRepository.deleteImportRows(importRow.id, db);
      await orderImportsRepository.deleteImport(importRow.id, db);
    }
    await insertAuditLog({
      entity_type: "order",
      entity_id: orderId,
      action: "DELETE",
      before_data: { id: order.id, status: order.status, order_import_id: order.order_import_id, keep_import: keepImport },
    }, db);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
  if (!keepImport && importRow?.stored_file_name) {
    await deleteOrderUploadAfterCommit(importRow.stored_file_name);
  }
  return { deleted: true, id: orderId, import_deleted: !keepImport };
}

export async function cancelOrder(orderIdParam) {
  const orderId = parseId(orderIdParam);
  const order = await ordersRepository.getOrderById(orderId);
  if (!order) {
    throw new AppError("ORDER_NOT_FOUND", "거래를 찾을 수 없습니다.", 404);
  }
  if (order.status !== "CONFIRMED") {
    throw new AppError("ORDER_NOT_CONFIRMED", "확정된 거래만 취소할 수 있습니다.", 400);
  }
  const cancelled = await ordersRepository.cancelConfirmedOrder(orderId);
  await insertAuditLog({
    entity_type: "order",
    entity_id: orderId,
    action: "CANCEL",
    before_data: { id: order.id, status: order.status, total_invoice_amount: order.total_invoice_amount },
  });
  return cancelled;
}

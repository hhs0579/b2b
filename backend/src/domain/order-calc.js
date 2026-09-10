import { createHash } from "node:crypto";
import { lineAmounts, marginRate } from "./money.js";
import { projectInvoiceLines } from "./invoice-projection.js";
import { applyShippingConfig, summarizeShipping } from "./shipping-config.js";

export function normalizeAddressKey(value) {
  if (value == null) {
    return "";
  }
  return String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function shippingFeeForProduct(priceRow, product) {
  if (priceRow.shipping_fee_override == null) {
    return {
      shipping_fee_per_carton: product.default_shipping_fee,
      shipping_fee_source: "PRODUCT_DEFAULT",
    };
  }
  return {
    shipping_fee_per_carton: priceRow.shipping_fee_override,
    shipping_fee_source: "CLIENT_OVERRIDE",
  };
}

function groupKeyForRow(mode, row) {
  if (mode === "PER_ORDER") {
    return String(row.external_order_number || "").trim();
  }
  if (mode === "PER_ADDRESS") {
    return normalizeAddressKey(row.address);
  }
  return "TOTAL";
}

function groupLabel(mode, key) {
  if (mode === "PER_ORDER") {
    return key;
  }
  if (mode === "PER_ADDRESS") {
    return key;
  }
  return "전체 수량";
}

export function calculateOrderPreview({
  rows,
  productsById,
  pricesByProductId,
  settings,
}) {
  const shippingType = settings.shipping_type;
  const mode = settings.shipping_calculation_mode;
  const manualCharge = settings.manual_shipping_charge;
  const blocking_errors = [];
  const warnings = [];
  const items = [];

  for (const row of rows) {
    const optionId = row.matched_product_option_id;
    const product = productsById.get(optionId);
    if (!product) {
      blocking_errors.push({
        code: "PRODUCT_NOT_FOUND",
        message: `${row.source_row_number}행: 내부 상품을 찾을 수 없습니다.`,
        source_row_number: row.source_row_number,
      });
      continue;
    }
    if (!product.is_active) {
      blocking_errors.push({
        code: "PRODUCT_INACTIVE",
        message: `${row.source_row_number}행: 비활성 상품입니다.`,
        source_row_number: row.source_row_number,
        product_option_id: optionId,
        product_id: product.product_id,
      });
    }
    const price = pricesByProductId.get(optionId);
    if (!price) {
      blocking_errors.push({
        code: "PRICE_NOT_FOUND",
        message: `${row.source_row_number}행: 발주일 기준 제안가가 없습니다.`,
        source_row_number: row.source_row_number,
        product_option_id: optionId,
        product_id: product.product_id,
      });
      continue;
    }
    if (mode === "PER_ORDER" && !String(row.external_order_number || "").trim()) {
      blocking_errors.push({
        code: "ORDER_NUMBER_REQUIRED_FOR_SHIPPING",
        message: `${row.source_row_number}행: 주문번호별 배송비 계산에는 주문번호가 필요합니다.`,
        source_row_number: row.source_row_number,
      });
    }
    if (mode === "PER_ADDRESS" && !normalizeAddressKey(row.address)) {
      blocking_errors.push({
        code: "ADDRESS_REQUIRED_FOR_SHIPPING",
        message: `${row.source_row_number}행: 배송지별 배송비 계산에는 주소가 필요합니다.`,
        source_row_number: row.source_row_number,
      });
    }

    const fee = shippingFeeForProduct(price, product);
    const amounts = lineAmounts(row.quantity, price.sale_price, product.purchase_price);
    items.push({
      source_import_row_id: row.id,
      source_row_number: row.source_row_number,
      product_id: product.product_id,
      product_option_id: optionId,
      product_code: product.product_code,
      product_name: product.product_name,
      option_name: product.option_name,
      quantity: row.quantity,
      purchase_price: product.purchase_price,
      sale_price: price.sale_price,
      price_source_id: price.id,
      carton_qty: product.carton_qty,
      ...fee,
      ...amounts,
      external_order_number: row.external_order_number,
      recipient_name: row.recipient_name,
      phone: row.phone,
      address: row.address,
      shipping_memo: row.shipping_memo,
      group_key: groupKeyForRow(mode, row),
    });
  }

  if ((shippingType === "TRUCK" || shippingType === "MANUAL") && manualCharge == null) {
    blocking_errors.push({
      code: "MANUAL_SHIPPING_CHARGE_REQUIRED",
      message: shippingType === "TRUCK" ? "용차비를 입력하세요." : "수동 배송비를 입력하세요.",
    });
  }

  const groupsMap = new Map();
  for (const item of items) {
    const mapKey = `${item.group_key}::${item.product_option_id}`;
    const existing = groupsMap.get(mapKey);
    if (existing) {
      existing.total_quantity += item.quantity;
    } else {
      groupsMap.set(mapKey, {
        shipping_calculation_mode: mode,
        group_key: item.group_key,
        group_label: groupLabel(mode, item.group_key),
        product_id: item.product_id,
        product_option_id: item.product_option_id,
        product_name: item.product_name,
        option_name: item.option_name,
        total_quantity: item.quantity,
        carton_qty: item.carton_qty,
        shipping_fee_per_carton: item.shipping_fee_per_carton,
        shipping_fee_source: item.shipping_fee_source,
        sale_price: item.sale_price,
      });
    }
  }

  const { groups: shipping_groups } = applyShippingConfig([...groupsMap.values()], settings, blocking_errors);
  const shippingSummary = summarizeShipping(shipping_groups, settings);
  const totalCartons = shipping_groups.reduce((sum, group) => sum + group.carton_count, 0);
  const total_shipping_charge = shippingSummary.total_shipping_charge;
  if (shippingSummary.truck_missing && !blocking_errors.some((item) => item.code === "MANUAL_SHIPPING_CHARGE_REQUIRED")) {
    blocking_errors.push({
      code: "MANUAL_SHIPPING_CHARGE_REQUIRED",
      message: "용차비를 입력하세요.",
    });
  }
  if (shippingSummary.manual_missing && !blocking_errors.some((item) => item.code === "MANUAL_SHIPPING_CHARGE_REQUIRED")) {
    blocking_errors.push({
      code: "MANUAL_SHIPPING_CHARGE_REQUIRED",
      message: "수동 배송비를 입력하세요.",
    });
  }

  const productAgg = new Map();
  for (const item of items) {
    const key = String(item.product_option_id);
    const existing = productAgg.get(key);
    if (existing) {
      existing.total_quantity += item.quantity;
      existing.product_sales_amount += item.product_sales_amount;
      existing.product_cost_amount += item.product_cost_amount;
      existing.product_margin_amount += item.product_margin_amount;
    } else {
      productAgg.set(key, {
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

  const product_totals = [...productAgg.values()].map((row) => {
    const carton_count = cartonByProduct.get(row.product_option_id) || 0;
    return {
      ...row,
      product_margin_rate: marginRate(row.product_sales_amount, row.product_margin_amount),
      carton_count,
      shipping_charge: parcelChargeByProduct.get(row.product_option_id) || 0,
    };
  });

  for (const row of product_totals) {
    if (row.product_margin_amount < 0) {
      warnings.push({
        code: "NEGATIVE_MARGIN",
        message: `${row.product_name}: 상품마진 ${row.product_margin_amount}원`,
        product_option_id: row.product_option_id,
        product_id: row.product_id,
      });
    }
  }

  const projected = projectInvoiceLines({
    shippingType,
    manualCharge,
    items,
    shippingGroups: shipping_groups,
    truckGroups: settings.shipping_config?.truck_groups || {},
    truckCharge: shippingSummary.truck_shipping_charge,
    manualChargeTotal: shippingSummary.manual_shipping_charge,
  });
  const invoice_product_lines = projected.invoice_product_lines;
  const invoice_shipping_lines = projected.invoice_shipping_lines;
  const invoice_product_line_count = projected.invoice_product_line_count;
  const invoice_shipping_line_count = projected.invoice_shipping_line_count;
  const invoice_required_line_count = projected.invoice_required_line_count;

  const uniqueCodes = new Set(blocking_errors.map((item) => item.code));
  const total_quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const total_product_sales = items.reduce((sum, item) => sum + item.product_sales_amount, 0);
  const total_product_cost = items.reduce((sum, item) => sum + item.product_cost_amount, 0);
  const total_product_margin = total_product_sales - total_product_cost;
  const total_invoice_amount = total_product_sales + total_shipping_charge;

  return {
    blocking_errors,
    blocking_codes: [...uniqueCodes],
    warnings,
    can_confirm:
      blocking_errors.length === 0 &&
      items.length > 0,
    items,
    product_totals,
    shipping_groups,
    shipping_summary: shippingSummary,
    invoice_product_lines,
    invoice_shipping_lines,
    totals: {
      product_count: product_totals.length,
      total_quantity,
      total_cartons: totalCartons,
      total_product_sales,
      total_product_cost,
      total_product_margin,
      total_product_margin_rate: marginRate(total_product_sales, total_product_margin),
      total_shipping_charge,
      parcel_shipping_charge: shippingSummary.parcel_shipping_charge,
      truck_shipping_charge: shippingSummary.truck_shipping_charge,
      manual_shipping_charge_total: shippingSummary.manual_shipping_charge,
      total_invoice_amount,
      invoice_product_line_count,
      invoice_shipping_line_count,
      invoice_required_line_count,
      negative_margin_count: warnings.filter((item) => item.code === "NEGATIVE_MARGIN").length,
    },
  };
}

export function previewSignature(preview, settings) {
  const payload = {
    shipping_type: settings.shipping_type,
    shipping_calculation_mode: settings.shipping_calculation_mode,
    manual_shipping_charge: settings.manual_shipping_charge ?? null,
    shipping_config: settings.shipping_config || {},
    items: preview.items.map((item) => ({
      source_import_row_id: item.source_import_row_id,
      product_id: item.product_id,
      product_option_id: item.product_option_id,
      quantity: item.quantity,
      sale_price: item.sale_price,
      purchase_price: item.purchase_price,
      price_source_id: item.price_source_id,
      carton_qty: item.carton_qty,
      shipping_fee_per_carton: item.shipping_fee_per_carton,
    })),
    groups: preview.shipping_groups.map((group) => ({
      group_key: group.group_key,
      product_id: group.product_id,
      product_option_id: group.product_option_id,
      total_quantity: group.total_quantity,
      carton_count: group.carton_count,
      shipping_charge: group.shipping_charge,
      shipping_type: group.shipping_type,
      truck_group_key: group.truck_group_key || null,
    })),
    totals: preview.totals,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

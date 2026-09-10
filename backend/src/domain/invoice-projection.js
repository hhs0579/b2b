import { cartonCount } from "./carton.js";
import { productInvoiceNote } from "./invoice-note.js";

function parcelLabel(unitPrice) {
  return `택배비-${unitPrice.toLocaleString("ko-KR")}원`;
}

function salePriceForOption(items, productOptionId) {
  const item = items.find((row) => String(row.product_option_id) === String(productOptionId));
  return item?.sale_price ?? item?.sale_price_snapshot ?? 0;
}

function productLineKey({ productOptionId, salePrice, shippingType, shippingFeePerCarton }) {
  return `${productOptionId}::${salePrice}::${shippingType}::${shippingFeePerCarton}`;
}

function buildProductLine({
  product_id,
  product_option_id,
  product_name,
  option_name,
  quantity,
  salePrice,
  shippingType,
  shippingFeePerCarton,
  cartonCountValue,
}) {
  return {
    kind: "PRODUCT",
    product_id,
    product_option_id,
    product_name,
    option_name: option_name || "",
    label: option_name ? `${product_name} ${option_name}` : product_name,
    quantity,
    unit_price: salePrice,
    amount: quantity * salePrice,
    shipping_type: shippingType,
    shipping_fee_per_carton: shippingFeePerCarton,
    carton_count: cartonCountValue,
    note: productInvoiceNote(shippingType, {
      shippingFeePerCarton,
      cartonCount: cartonCountValue,
    }),
  };
}

function addProductLine(map, line) {
  const key = productLineKey({
    productOptionId: line.product_option_id,
    salePrice: line.unit_price,
    shippingType: line.shipping_type,
    shippingFeePerCarton: line.shipping_fee_per_carton,
  });
  const existing = map.get(key);
  if (existing) {
    existing.quantity += line.quantity;
    existing.amount += line.amount;
    existing.carton_count += line.carton_count;
    existing.note = productInvoiceNote(existing.shipping_type, {
      shippingFeePerCarton: existing.shipping_fee_per_carton,
      cartonCount: existing.carton_count,
    });
    return;
  }
  map.set(key, line);
}

function productLinesFromItems(items, shippingType) {
  const productLineMap = new Map();
  for (const item of items) {
    const salePrice = item.sale_price ?? item.sale_price_snapshot ?? 0;
    const fee = item.shipping_fee_per_carton ?? 0;
    addProductLine(
      productLineMap,
      buildProductLine({
        product_id: item.product_id,
        product_option_id: item.product_option_id,
        product_name: item.product_name,
        option_name: item.option_name,
        quantity: item.quantity,
        salePrice,
        shippingType,
        shippingFeePerCarton: fee,
        cartonCountValue: cartonCount(item.quantity, item.carton_qty || 1),
      }),
    );
  }
  return [...productLineMap.values()];
}

function productLinesFromGroups(shippingGroups, items, shippingType) {
  const productLineMap = new Map();
  for (const group of shippingGroups) {
    const salePrice = group.sale_price ?? salePriceForOption(items, group.product_option_id);
    const shippingTypeOfGroup = group.shipping_type || shippingType;
    const fee = group.shipping_fee_per_carton ?? 0;
    addProductLine(
      productLineMap,
      buildProductLine({
        product_id: group.product_id,
        product_option_id: group.product_option_id,
        product_name: group.product_name,
        option_name: group.option_name,
        quantity: group.total_quantity,
        salePrice,
        shippingType: shippingTypeOfGroup,
        shippingFeePerCarton: fee,
        cartonCountValue: group.carton_count || 0,
      }),
    );
  }
  return [...productLineMap.values()];
}

export function projectInvoiceLines({
  shippingType,
  manualCharge,
  items = [],
  shippingGroups = [],
  truckGroups = {},
  truckCharge,
  manualChargeTotal,
}) {
  const invoice_product_lines = shippingGroups.length
    ? productLinesFromGroups(shippingGroups, items, shippingType)
    : productLinesFromItems(items, shippingType);

  const invoice_shipping_lines = [];
  const feeMap = new Map();
  for (const group of shippingGroups) {
    if ((group.shipping_type || shippingType) !== "PARCEL") {
      continue;
    }
    const fee = group.shipping_fee_per_carton;
    if (fee <= 0) {
      continue;
    }
    feeMap.set(fee, (feeMap.get(fee) || 0) + group.carton_count);
  }
  for (const [unit_price, quantity] of [...feeMap.entries()].sort((a, b) => a[0] - b[0])) {
    invoice_shipping_lines.push({
      kind: "SHIPPING",
      shipping_kind: "PARCEL",
      product_name: parcelLabel(unit_price),
      option_name: "",
      label: parcelLabel(unit_price),
      quantity,
      unit_price,
      amount: quantity * unit_price,
      note: "",
    });
  }

  let resolvedTruckCharge = truckCharge;
  if (resolvedTruckCharge == null) {
    const truckGroupsUsed = shippingGroups.filter((group) => (group.shipping_type || shippingType) === "TRUCK");
    if (truckGroupsUsed.length) {
      const keys = [...new Set(truckGroupsUsed.map((group) => group.truck_group_key).filter(Boolean))];
      if (keys.length === 0) {
        resolvedTruckCharge = manualCharge || 0;
      } else {
        const seen = new Set();
        resolvedTruckCharge = 0;
        for (const group of truckGroupsUsed) {
          const key = group.truck_group_key;
          if (!key || seen.has(key)) {
            continue;
          }
          seen.add(key);
          const amount = truckGroups[key]?.manual_shipping_charge ?? group.manual_shipping_charge;
          if (amount) {
            resolvedTruckCharge += amount;
          }
        }
      }
    } else {
      resolvedTruckCharge = 0;
    }
  }

  if (resolvedTruckCharge > 0) {
    invoice_shipping_lines.push({
      kind: "SHIPPING",
      shipping_kind: "TRUCK",
      product_name: "용차비",
      option_name: "",
      label: "용차비",
      quantity: 1,
      unit_price: resolvedTruckCharge,
      amount: resolvedTruckCharge,
      note: "",
    });
  }

  const resolvedManual =
    manualChargeTotal != null
      ? manualChargeTotal
      : shippingGroups.some((group) => (group.shipping_type || shippingType) === "MANUAL")
        ? manualCharge || 0
        : shippingType === "MANUAL"
          ? manualCharge || 0
          : 0;
  if (resolvedManual > 0) {
    invoice_shipping_lines.push({
      kind: "SHIPPING",
      shipping_kind: "MANUAL",
      product_name: "배송비",
      option_name: "",
      label: "배송비",
      quantity: 1,
      unit_price: resolvedManual,
      amount: resolvedManual,
      note: "",
    });
  }

  const invoice_lines = [...invoice_product_lines, ...invoice_shipping_lines];
  return {
    invoice_product_lines,
    invoice_shipping_lines,
    invoice_lines,
    invoice_product_line_count: invoice_product_lines.length,
    invoice_shipping_line_count: invoice_shipping_lines.length,
    invoice_required_line_count: invoice_lines.length,
  };
}

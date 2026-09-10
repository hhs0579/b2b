import { cartonCount } from "./carton.js";

export const SHIPPING_TYPE_LABELS = Object.freeze({
  PARCEL: "택배",
  FREE: "무료배송",
  COLLECT: "착불",
  TRUCK: "용차",
  MANUAL: "수동배송비",
});

export function emptyShippingConfig() {
  return { overrides: {}, splits: [], truck_groups: {} };
}

export function parseShippingConfig(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const overrides = src.overrides && typeof src.overrides === "object" && !Array.isArray(src.overrides) ? src.overrides : {};
  const truck_groups =
    src.truck_groups && typeof src.truck_groups === "object" && !Array.isArray(src.truck_groups) ? src.truck_groups : {};
  const splits = Array.isArray(src.splits) ? src.splits : [];
  return { overrides, splits, truck_groups };
}

export function groupIdentity(groupKey, productOptionId) {
  return `${groupKey}::${productOptionId}`;
}

export function effectiveShippingType(group, orderShippingType) {
  return group.shipping_type_override || group.shipping_type || orderShippingType;
}

export function mixedShippingLabel(types) {
  const unique = [...new Set(types.filter(Boolean))];
  if (unique.length <= 1) {
    return SHIPPING_TYPE_LABELS[unique[0]] || "";
  }
  const hasParcel = unique.includes("PARCEL");
  const hasTruck = unique.includes("TRUCK");
  const onlyParcelTruck = unique.every((type) => type === "PARCEL" || type === "TRUCK");
  if (hasParcel && hasTruck && onlyParcelTruck) {
    return "혼합배송";
  }
  return "혼합배송";
}

export function invoiceShippingMethodDefault(types) {
  const unique = [...new Set(types.filter(Boolean))];
  if (unique.length === 0) {
    return "";
  }
  if (unique.length === 1) {
    return {
      PARCEL: "택배출고",
      TRUCK: "용차출고",
      COLLECT: "착불",
      FREE: "무료배송",
      MANUAL: "수동배송",
    }[unique[0]] || "";
  }
  const onlyParcelTruck = unique.every((type) => type === "PARCEL" || type === "TRUCK");
  if (onlyParcelTruck && unique.includes("PARCEL") && unique.includes("TRUCK")) {
    return "택배 / 용차 혼합출고";
  }
  return unique.map((type) => SHIPPING_TYPE_LABELS[type] || type).join(" / ");
}

function nextSplitId(splits) {
  const used = new Set(splits.map((item) => String(item.id || "")));
  let index = 1;
  while (used.has(`s${index}`)) {
    index += 1;
  }
  return `s${index}`;
}

export function nextTruckGroupKey(truckGroups) {
  const used = new Set(Object.keys(truckGroups || {}));
  let index = 1;
  while (used.has(`TRUCK-${index}`)) {
    index += 1;
  }
  return `TRUCK-${index}`;
}

export function applyShippingConfig(baseGroups, settings, errors = []) {
  const config = parseShippingConfig(settings.shipping_config);
  const orderType = settings.shipping_type;
  const groups = baseGroups.map((group) => {
    const identity = group.identity || groupIdentity(group.group_key, group.product_option_id);
    const override = config.overrides[identity] || {};
    return {
      ...group,
      identity,
      split_id: null,
      base_identity: identity,
      total_quantity: group.total_quantity,
      shipping_type_override: override.shipping_type || null,
      truck_group_key: override.truck_group_key || null,
      group_note: override.group_note || null,
      manual_shipping_charge: override.manual_shipping_charge ?? null,
    };
  });

  for (const split of config.splits) {
    const parent = groups.find((group) => group.identity === split.base_key && !group.split_id);
    const qty = Number(split.quantity);
    if (!parent) {
      errors.push({ code: "INVALID_SHIPPING_SPLIT", message: "분리할 배송그룹을 찾을 수 없습니다." });
      continue;
    }
    if (!Number.isInteger(qty) || qty < 1 || qty >= parent.total_quantity) {
      errors.push({
        code: "INVALID_SHIPPING_SPLIT",
        message: `${parent.product_name}: 분리 수량이 올바르지 않습니다.`,
      });
      continue;
    }
    parent.total_quantity -= qty;
    const splitId = split.id || nextSplitId(config.splits);
    groups.push({
      ...parent,
      identity: `${split.base_key}::split:${splitId}`,
      split_id: splitId,
      base_identity: split.base_key,
      total_quantity: qty,
      shipping_type_override: split.shipping_type || null,
      truck_group_key: split.truck_group_key || null,
      group_note: split.group_note || null,
      manual_shipping_charge: split.manual_shipping_charge ?? null,
    });
  }

  for (const group of groups) {
    group.carton_count = cartonCount(group.total_quantity, group.carton_qty);
    group.shipping_type = effectiveShippingType(group, orderType);
    group.shipping_type_source = group.shipping_type_override ? "GROUP_OVERRIDE" : "ORDER_DEFAULT";
    group.auto_parcel_charge = group.carton_count * group.shipping_fee_per_carton;
    group.shipping_charge = group.shipping_type === "PARCEL" ? group.auto_parcel_charge : 0;
    if (group.shipping_type === "TRUCK") {
      group.group_note = group.group_note || "용차출고";
      if (group.truck_group_key && config.truck_groups[group.truck_group_key]) {
        group.manual_shipping_charge = config.truck_groups[group.truck_group_key].manual_shipping_charge ?? null;
      } else if (group.manual_shipping_charge == null) {
        group.manual_shipping_charge = settings.manual_shipping_charge ?? null;
      }
    } else if (group.shipping_type === "MANUAL") {
      if (group.manual_shipping_charge == null) {
        group.manual_shipping_charge = settings.manual_shipping_charge ?? null;
      }
    } else {
      group.manual_shipping_charge = null;
    }
  }

  return { groups, config };
}

function uniqueTruckCharge(groups, truckGroups, orderManualCharge) {
  const truckGroupsUsed = groups.filter((group) => group.shipping_type === "TRUCK");
  if (truckGroupsUsed.length === 0) {
    return { total: 0, missing: false, details: [] };
  }
  const keys = [...new Set(truckGroupsUsed.map((group) => group.truck_group_key).filter(Boolean))];
  if (keys.length === 0) {
    return {
      total: orderManualCharge == null ? 0 : orderManualCharge,
      missing: orderManualCharge == null,
      details: orderManualCharge == null ? [] : [{ key: "ORDER", amount: orderManualCharge }],
    };
  }
  let total = 0;
  let missing = false;
  const details = [];
  for (const key of keys) {
    const amount = truckGroups[key]?.manual_shipping_charge;
    if (amount == null) {
      missing = true;
      continue;
    }
    total += amount;
    details.push({ key, amount, label: truckGroups[key]?.label || key });
  }
  return { total, missing, details };
}

function uniqueManualCharge(groups, orderType, orderManualCharge) {
  const manualGroups = groups.filter((group) => group.shipping_type === "MANUAL");
  if (manualGroups.length === 0) {
    return { total: 0, missing: false };
  }
  if (orderType === "MANUAL" && groups.every((group) => group.shipping_type === "MANUAL")) {
    return {
      total: orderManualCharge == null ? 0 : orderManualCharge,
      missing: orderManualCharge == null,
    };
  }
  const amounts = manualGroups.map((group) => group.manual_shipping_charge);
  if (amounts.some((value) => value == null)) {
    if (orderManualCharge == null) {
      return { total: 0, missing: true };
    }
    return { total: orderManualCharge, missing: false };
  }
  const unique = [...new Set(amounts)];
  return { total: unique.reduce((sum, value) => sum + value, 0), missing: false };
}

export function summarizeShipping(groups, settings) {
  const config = parseShippingConfig(settings.shipping_config);
  const parcel = groups.filter((group) => group.shipping_type === "PARCEL").reduce((sum, group) => sum + group.shipping_charge, 0);
  const truck = uniqueTruckCharge(groups, config.truck_groups, settings.manual_shipping_charge);
  const manual = uniqueManualCharge(groups, settings.shipping_type, settings.manual_shipping_charge);
  const types = [...new Set(groups.map((group) => group.shipping_type))];
  return {
    types,
    is_mixed: types.length > 1,
    display_shipping_type: mixedShippingLabel(types),
    invoice_shipping_method: invoiceShippingMethodDefault(types),
    parcel_shipping_charge: parcel,
    truck_shipping_charge: truck.total,
    manual_shipping_charge: manual.total,
    total_shipping_charge: parcel + truck.total + manual.total,
    truck_missing: truck.missing,
    manual_missing: manual.missing,
    truck_details: truck.details,
  };
}

export function applyAllGroupsConfig(baseGroups, shippingType, manualCharge, previousConfig) {
  if (shippingType !== "TRUCK") {
    return emptyShippingConfig();
  }
  const prev = parseShippingConfig(previousConfig);
  const truckKey = Object.keys(prev.truck_groups)[0] || "TRUCK-1";
  const truck_groups = {
    [truckKey]: {
      label: prev.truck_groups[truckKey]?.label || "용차 1",
      manual_shipping_charge: manualCharge,
    },
  };
  const overrides = {};
  for (const group of baseGroups) {
    const identity = group.identity || groupIdentity(group.group_key, group.product_option_id);
    overrides[identity] = {
      shipping_type: "TRUCK",
      truck_group_key: truckKey,
      group_note: "용차출고",
    };
  }
  return { overrides, splits: [], truck_groups };
}

export function hydrateSnapshotGroups(groups, orderShippingType) {
  return (groups || []).map((group) => ({
    ...group,
    shipping_type: group.shipping_type || orderShippingType,
    shipping_type_source: group.shipping_type_source || (group.shipping_type ? "GROUP_OVERRIDE" : "ORDER_DEFAULT"),
  }));
}

const ALLOWED_SHIPPING_TYPES = new Set(["PARCEL", "FREE", "COLLECT", "TRUCK", "MANUAL"]);

function optionalCharge(value, errors, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push({ code: "INVALID_SHIPPING_CONFIG", message: `${label}는 0 이상의 정수여야 합니다.` });
    return null;
  }
  return parsed;
}

export function normalizeShippingConfig(raw) {
  const errors = [];
  const parsed = parseShippingConfig(raw);
  const overrides = {};
  for (const [key, value] of Object.entries(parsed.overrides)) {
    const override = value && typeof value === "object" ? value : {};
    if (override.shipping_type && !ALLOWED_SHIPPING_TYPES.has(override.shipping_type)) {
      errors.push({ code: "INVALID_SHIPPING_TYPE", message: "배송방식이 올바르지 않습니다." });
      continue;
    }
    overrides[String(key)] = {
      shipping_type: override.shipping_type || null,
      truck_group_key: override.truck_group_key || null,
      group_note: override.group_note || null,
      manual_shipping_charge: optionalCharge(override.manual_shipping_charge, errors, "수동 배송비"),
    };
  }
  const splits = [];
  for (const split of parsed.splits) {
    const item = split && typeof split === "object" ? split : {};
    if (item.shipping_type && !ALLOWED_SHIPPING_TYPES.has(item.shipping_type)) {
      errors.push({ code: "INVALID_SHIPPING_TYPE", message: "배송방식이 올바르지 않습니다." });
      continue;
    }
    splits.push({
      id: item.id || null,
      base_key: item.base_key || "",
      quantity: item.quantity,
      shipping_type: item.shipping_type || null,
      truck_group_key: item.truck_group_key || null,
      group_note: item.group_note || null,
      manual_shipping_charge: optionalCharge(item.manual_shipping_charge, errors, "수동 배송비"),
    });
  }
  const truck_groups = {};
  for (const [key, value] of Object.entries(parsed.truck_groups)) {
    const group = value && typeof value === "object" ? value : {};
    truck_groups[String(key)] = {
      label: group.label || key,
      manual_shipping_charge: optionalCharge(group.manual_shipping_charge, errors, "용차비"),
    };
  }
  return { config: { overrides, splits, truck_groups }, errors };
}

export function hasGroupOverrides(config) {
  const parsed = parseShippingConfig(config);
  return Object.keys(parsed.overrides).length > 0 || parsed.splits.length > 0;
}

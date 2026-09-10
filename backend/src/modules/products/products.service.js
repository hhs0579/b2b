import { AppError } from "../../utils/app-error.js";
import {
  VAT_TYPES,
  SHIPPING_TYPES,
  optionalBooleanQuery,
  optionalIdQuery,
  optionalText,
  paginationFromQuery,
  parseId,
  requiredBoolean,
  requiredInt,
  requiredText,
  oneOf,
} from "../../utils/validation.js";
import * as productsRepository from "./products.repository.js";
import { insertAuditLog } from "../audit/audit.repository.js";
import { optionImpact, productImpact } from "../deletions/impact.repository.js";

function parseOptionInput(body, { requireActiveDefault = true } = {}) {
  return {
    option_name: optionalText(body.option_name),
    product_code: optionalText(body.product_code),
    barcode: optionalText(body.barcode),
    purchase_price: requiredInt(body.purchase_price, {
      min: 0,
      code: "INVALID_PURCHASE_PRICE",
      message: "원가는 0 이상의 정수(원)여야 합니다.",
    }),
    vat_type: oneOf(body.vat_type, VAT_TYPES, "INVALID_VAT_TYPE", "VAT 구분이 올바르지 않습니다."),
    carton_qty: requiredInt(body.carton_qty, {
      min: 1,
      code: "INVALID_CARTON_QTY",
      message: "카톤입수량은 1 이상의 정수여야 합니다.",
    }),
    default_shipping_fee: requiredInt(body.default_shipping_fee, {
      min: 0,
      code: "INVALID_SHIPPING_FEE",
      message: "카톤당 기본 택배비는 0 이상의 정수(원)여야 합니다.",
    }),
    default_shipping_type: oneOf(
      body.default_shipping_type,
      SHIPPING_TYPES,
      "INVALID_SHIPPING_TYPE",
      "기본 배송방식이 올바르지 않습니다.",
    ),
    is_active:
      body.is_active == null
        ? requireActiveDefault
        : requiredBoolean(body.is_active, "INVALID_IS_ACTIVE", "활성여부가 올바르지 않습니다."),
    cost_change_reason: optionalText(body.cost_change_reason),
  };
}

function parseOptions(body) {
  if (Array.isArray(body.options)) {
    if (body.options.length === 0) {
      throw new AppError("OPTIONS_REQUIRED", "최소 1개의 옵션이 필요합니다.", 400);
    }
    return body.options.map((item) => parseOptionInput(item));
  }
  if (body.purchase_price == null && body.vat_type == null && body.carton_qty == null) {
    throw new AppError("OPTIONS_REQUIRED", "최소 1개의 옵션이 필요합니다.", 400);
  }
  return [parseOptionInput(body)];
}

function parseProductBody(body) {
  return {
    product_name: requiredText(body.product_name, "PRODUCT_NAME_REQUIRED", "상품명은 필수입니다."),
    supplier_id: (() => {
      if (body.supplier_id == null || body.supplier_id === "") {
        throw new AppError("SUPPLIER_REQUIRED", "매입처는 필수입니다.", 400);
      }
      return parseId(body.supplier_id, "SUPPLIER_REQUIRED");
    })(),
    memo: optionalText(body.memo),
    is_active:
      body.is_active == null
        ? true
        : requiredBoolean(body.is_active, "INVALID_IS_ACTIVE", "활성여부가 올바르지 않습니다."),
  };
}

export async function listProducts(query) {
  const { page, limit, offset } = paginationFromQuery(query);
  const { items, total } = await productsRepository.listProducts({
    search: optionalText(query.search),
    supplierId: optionalIdQuery(query.supplier_id),
    isActive: optionalBooleanQuery(query.is_active),
    limit,
    offset,
  });

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

export async function getProduct(idParam) {
  const id = parseId(idParam);
  const product = await productsRepository.getProductById(id);
  if (!product) {
    throw new AppError("PRODUCT_NOT_FOUND", "상품을 찾을 수 없습니다.", 404);
  }
  return product;
}

export async function createProduct(body) {
  const input = parseProductBody(body);
  const options = parseOptions(body);
  const supplierOk = await productsRepository.supplierExists(input.supplier_id);
  if (!supplierOk) {
    throw new AppError("SUPPLIER_NOT_FOUND", "존재하지 않는 매입처입니다.", 400);
  }
  return productsRepository.createProduct({ ...input, options });
}

export async function updateProduct(idParam, body) {
  const current = await getProduct(idParam);
  const input = parseProductBody({ ...current, ...body });
  const supplierOk = await productsRepository.supplierExists(input.supplier_id);
  if (!supplierOk) {
    throw new AppError("SUPPLIER_NOT_FOUND", "존재하지 않는 매입처입니다.", 400);
  }
  const updated = await productsRepository.updateProductBody(current.id, input);

  if (Array.isArray(body.options)) {
    for (const item of body.options) {
      if (item.id) {
        await updateOption(current.id, item.id, item);
      } else {
        await addOption(current.id, item);
      }
    }
    return productsRepository.getProductById(current.id);
  }

  const looksLikeOptionPatch =
    body.purchase_price != null ||
    body.option_name !== undefined ||
    body.product_code !== undefined ||
    body.barcode !== undefined ||
    body.vat_type != null ||
    body.carton_qty != null ||
    body.default_shipping_fee != null ||
    body.default_shipping_type != null;
  if (looksLikeOptionPatch) {
    if (current.options.length !== 1) {
      throw new AppError("OPTION_ID_REQUIRED", "옵션이 여러 개인 상품은 옵션을 지정해 수정하세요.", 400);
    }
    return updateOption(current.id, current.options[0].id, { ...current.options[0], ...body });
  }

  return updated;
}

export async function addOption(productIdParam, body) {
  const product = await getProduct(productIdParam);
  const option = parseOptionInput(body);
  return productsRepository.createOption(product.id, option);
}

export async function updateOption(productIdParam, optionIdParam, body) {
  const product = await getProduct(productIdParam);
  const optionId = parseId(optionIdParam);
  const current = product.options.find((item) => item.id === optionId);
  if (!current) {
    throw new AppError("PRODUCT_OPTION_NOT_FOUND", "상품 옵션을 찾을 수 없습니다.", 404);
  }
  const input = parseOptionInput({ ...current, ...body }, { requireActiveDefault: false });
  const priceChanged = current.purchase_price !== input.purchase_price;
  return productsRepository.updateOptionWithOptionalCostHistory(
    optionId,
    input,
    priceChanged,
    current.purchase_price,
  );
}

export async function updateProductStatus(idParam, body) {
  const current = await getProduct(idParam);
  const isActive = requiredBoolean(body.is_active, "INVALID_IS_ACTIVE", "활성여부가 올바르지 않습니다.");
  const updated = await productsRepository.updateProductStatus(current.id, isActive);
  await insertAuditLog({
    entity_type: "product",
    entity_id: current.id,
    action: isActive ? "REACTIVATE" : "DEACTIVATE",
    before_data: current,
  });
  return updated;
}

export async function updateOptionStatus(productIdParam, optionIdParam, body) {
  const product = await getProduct(productIdParam);
  const optionId = parseId(optionIdParam);
  const current = product.options.find((item) => item.id === optionId);
  if (!current) {
    throw new AppError("PRODUCT_OPTION_NOT_FOUND", "상품 옵션을 찾을 수 없습니다.", 404);
  }
  const isActive = requiredBoolean(body.is_active, "INVALID_IS_ACTIVE", "활성여부가 올바르지 않습니다.");
  const updated = await productsRepository.updateOptionStatus(optionId, isActive);
  await insertAuditLog({
    entity_type: "product_option",
    entity_id: optionId,
    action: isActive ? "REACTIVATE" : "DEACTIVATE",
    before_data: current,
  });
  return updated;
}

export async function getDeleteImpact(idParam) {
  const product = await getProduct(idParam);
  return { id: product.id, ...await productImpact(product.id) };
}

export async function getOptionDeleteImpact(productIdParam, optionIdParam) {
  const product = await getProduct(productIdParam);
  const optionId = parseId(optionIdParam);
  const current = product.options.find((item) => item.id === optionId);
  if (!current) {
    throw new AppError("PRODUCT_OPTION_NOT_FOUND", "상품 옵션을 찾을 수 없습니다.", 404);
  }
  return { id: optionId, ...await optionImpact(optionId) };
}

export async function deleteProduct(idParam) {
  const product = await getProduct(idParam);
  const impact = await productImpact(product.id);
  if (!impact.can_delete) {
    throw new AppError("PRODUCT_IN_USE", "제안가, Alias, 발주 또는 확정 거래에서 사용 중인 상품은 삭제할 수 없습니다.", 409, impact.references);
  }
  await productsRepository.deleteProduct(product.id);
  await insertAuditLog({
    entity_type: "product",
    entity_id: product.id,
    action: "DELETE",
    before_data: product,
  });
  return { deleted: true, id: product.id };
}

export async function deleteOption(productIdParam, optionIdParam) {
  const product = await getProduct(productIdParam);
  const optionId = parseId(optionIdParam);
  const current = product.options.find((item) => item.id === optionId);
  if (!current) {
    throw new AppError("PRODUCT_OPTION_NOT_FOUND", "상품 옵션을 찾을 수 없습니다.", 404);
  }
  if (product.options.length <= 1) {
    throw new AppError("LAST_OPTION_REQUIRED", "상품에는 최소 1개의 옵션이 필요합니다.", 409);
  }
  const impact = await optionImpact(optionId);
  if (!impact.can_delete) {
    throw new AppError("PRODUCT_OPTION_IN_USE", "제안가, Alias, 발주 또는 확정 거래에서 사용 중인 옵션은 삭제할 수 없습니다.", 409, impact.references);
  }
  await productsRepository.deleteOption(optionId);
  await insertAuditLog({
    entity_type: "product_option",
    entity_id: optionId,
    action: "DELETE",
    before_data: current,
  });
  return productsRepository.getProductById(product.id);
}

export async function getCostHistory(idParam) {
  const product = await getProduct(idParam);
  return productsRepository.listCostHistory(product.id);
}

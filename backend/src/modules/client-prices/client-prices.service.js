import { pool } from "../../db/pool.js";
import { addDaysIso, todayKst } from "../../domain/dates.js";
import { estimateProductMargin } from "../../domain/margin.js";
import { AppError } from "../../utils/app-error.js";
import { rethrowDatabaseError } from "../../utils/db-errors.js";
import {
  optionalBooleanQuery,
  optionalNonNegativeIntOrNull,
  parseId,
  requiredDate,
  requiredInt,
} from "../../utils/validation.js";
import * as salesClientsRepository from "../sales-clients/sales-clients.repository.js";
import * as clientPricesRepository from "./client-prices.repository.js";

function parsePriceItem(item) {
  const optionId = item.product_option_id ?? item.product_id;
  return {
    productOptionId: parseId(optionId, "INVALID_PRODUCT_OPTION_ID"),
    salePrice: requiredInt(item.sale_price, {
      min: 0,
      code: "INVALID_SALE_PRICE",
      message: "제안가는 0 이상의 정수(원)여야 합니다.",
    }),
    shippingFeeOverride: optionalNonNegativeIntOrNull(item.shipping_fee_override, {
      code: "INVALID_SHIPPING_FEE_OVERRIDE",
      message: "배송비 override는 비우거나 0 이상의 정수여야 합니다.",
    }),
  };
}

/**
 * 발주 확정 시 Frontend에 보이는 가격을 쓰지 않는다.
 * client + product + order_date(DATE, Asia/Seoul 달력일)로 이 함수를 다시 호출한다.
 */
export async function findEffectivePrice(clientId, productOptionId, onDate) {
  return clientPricesRepository.findEffectivePriceRow(clientId, productOptionId, onDate);
}

export async function applyPriceChange(db, { clientId, productOptionId, salePrice, shippingFeeOverride, effectiveFrom }) {
  const rows = await clientPricesRepository.listPricesForProductForUpdate(db, clientId, productOptionId);
  const sameFrom = rows.find((row) => row.effective_from === effectiveFrom);
  if (sameFrom) {
    return clientPricesRepository.updatePriceRow(db, sameFrom.id, {
      salePrice,
      shippingFeeOverride,
    });
  }

  const later = rows.filter((row) => row.effective_from > effectiveFrom);
  if (later.length > 0) {
    throw new AppError("PRICE_PERIOD_OVERLAP", "같은 매출처·상품의 가격 적용기간이 겹칩니다.", 409);
  }

  const covering = rows.find(
    (row) =>
      row.effective_from <= effectiveFrom &&
      (row.effective_to == null || row.effective_to >= effectiveFrom),
  );

  if (covering) {
    const closeTo = addDaysIso(effectiveFrom, -1);
    if (closeTo < covering.effective_from) {
      throw new AppError("INVALID_PRICE_PERIOD", "기존 가격 기간을 종료할 수 없습니다.", 400);
    }
    await clientPricesRepository.closePricePeriod(db, covering.id, closeTo);
  }

  return clientPricesRepository.insertPrice(db, {
    clientId,
    productOptionId,
    salePrice,
    shippingFeeOverride,
    effectiveFrom,
    effectiveTo: null,
  });
}

async function assertClientAllowsPriceChange(clientId) {
  const client = await salesClientsRepository.getSalesClientById(clientId);
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  if (!client.is_active) {
    throw new AppError("CLIENT_INACTIVE", "비활성 매출처에는 제안가를 등록할 수 없습니다.", 400);
  }
  return client;
}

async function assertOptionExists(productOptionId, db = pool) {
  const exists = await clientPricesRepository.optionExists(productOptionId, db);
  if (!exists) {
    throw new AppError("PRODUCT_NOT_FOUND", "존재하지 않는 상품입니다.", 400);
  }
}

function withMargin(row) {
  const { estimated_margin, estimated_margin_rate } = estimateProductMargin(
    row.current_sale_price,
    row.purchase_price,
  );
  return {
    ...row,
    estimated_margin,
    estimated_margin_rate,
  };
}

export async function getClientDetail(idParam) {
  const id = parseId(idParam);
  const client = await salesClientsRepository.getSalesClientById(id);
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  const products = await clientPricesRepository.listClientProducts(id, {
    onDate: todayKst(),
    includeInactive: false,
  });
  const priced = products.filter((item) => item.current_sale_price != null).length;
  return {
    ...client,
    priced_product_count: priced,
    unpriced_product_count: products.length - priced,
  };
}

export async function listHistory(clientIdParam) {
  const clientId = parseId(clientIdParam);
  const client = await salesClientsRepository.getSalesClientById(clientId);
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  return { items: await clientPricesRepository.listPriceHistory(clientId) };
}

export async function listEffective(clientIdParam, query) {
  const clientId = parseId(clientIdParam);
  const client = await salesClientsRepository.getSalesClientById(clientId);
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  const onDate = query.date ? requiredDate(query.date) : todayKst();
  return {
    date: onDate,
    items: await clientPricesRepository.listEffectivePrices(clientId, onDate),
  };
}

export async function listClientProducts(clientIdParam, query) {
  const clientId = parseId(clientIdParam);
  const client = await salesClientsRepository.getSalesClientById(clientId);
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  const onDate = query.date ? requiredDate(query.date) : todayKst();
  const includeInactive = optionalBooleanQuery(query.include_inactive) === true;
  const items = await clientPricesRepository.listClientProducts(clientId, { onDate, includeInactive });
  return {
    date: onDate,
    items: items.map(withMargin),
  };
}

export async function createPrice(clientIdParam, body) {
  const clientId = parseId(clientIdParam);
  await assertClientAllowsPriceChange(clientId);
  const item = parsePriceItem(body);
  await assertOptionExists(item.productOptionId);
  const effectiveFrom = requiredDate(body.effective_from, "INVALID_EFFECTIVE_FROM", "적용 시작일이 올바르지 않습니다.");

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const saved = await applyPriceChange(db, {
      clientId,
      productOptionId: item.productOptionId,
      salePrice: item.salePrice,
      shippingFeeOverride: item.shippingFeeOverride,
      effectiveFrom,
    });
    await db.query("COMMIT");
    return saved;
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // already rolled back
    }
    rethrowDatabaseError(err);
  } finally {
    db.release();
  }
}

export async function bulkSavePrices(clientIdParam, body) {
  const clientId = parseId(clientIdParam);
  await assertClientAllowsPriceChange(clientId);
  const effectiveFrom = requiredDate(
    body.effective_from,
    "INVALID_EFFECTIVE_FROM",
    "적용 시작일이 올바르지 않습니다.",
  );
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new AppError("PRICE_ITEMS_REQUIRED", "저장할 제안가 항목이 없습니다.", 400);
  }

  const items = body.items.map(parsePriceItem);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const saved = [];
    for (const item of items) {
      await assertOptionExists(item.productOptionId, db);
      saved.push(
        await applyPriceChange(db, {
          clientId,
          productOptionId: item.productOptionId,
          salePrice: item.salePrice,
          shippingFeeOverride: item.shippingFeeOverride,
          effectiveFrom,
        }),
      );
    }
    await db.query("COMMIT");
    return { items: saved };
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // already rolled back
    }
    rethrowDatabaseError(err);
  } finally {
    db.release();
  }
}

export async function getPriceDeleteImpact(clientIdParam, priceIdParam) {
  const client = await salesClientsRepository.getSalesClientById(parseId(clientIdParam));
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  const price = await clientPricesRepository.getPriceById(parseId(priceIdParam));
  if (!price || price.client_id !== client.id) {
    throw new AppError("PRICE_NOT_FOUND", "제안가를 찾을 수 없습니다.", 404);
  }
  const { priceImpact } = await import("../deletions/impact.repository.js");
  return { id: price.id, ...await priceImpact(price.id) };
}

export async function deletePrice(clientIdParam, priceIdParam) {
  const client = await salesClientsRepository.getSalesClientById(parseId(clientIdParam));
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  const price = await clientPricesRepository.getPriceById(parseId(priceIdParam));
  if (!price || price.client_id !== client.id) {
    throw new AppError("PRICE_NOT_FOUND", "제안가를 찾을 수 없습니다.", 404);
  }
  const { priceImpact } = await import("../deletions/impact.repository.js");
  const { insertAuditLog } = await import("../audit/audit.repository.js");
  const impact = await priceImpact(price.id);
  if (!impact.can_delete) {
    throw new AppError("PRICE_IN_USE", "확정 거래에서 사용된 제안가는 삭제할 수 없습니다.", 409, impact.references);
  }
  await clientPricesRepository.deletePrice(price.id);
  await insertAuditLog({
    entity_type: "client_product_price",
    entity_id: price.id,
    action: "DELETE",
    before_data: price,
  });
  return { deleted: true, id: price.id };
}

import { AppError } from "../../utils/app-error.js";
import { optionalText, parseId } from "../../utils/validation.js";
import { normalizeAliasText } from "../../domain/normalize.js";
import * as salesClientsRepository from "../sales-clients/sales-clients.repository.js";
import * as orderImportsRepository from "../order-imports/order-imports.repository.js";
import * as productAliasesRepository from "./product-aliases.repository.js";
import { insertAuditLog } from "../audit/audit.repository.js";

async function requireClient(idParam) {
  const id = parseId(idParam);
  const client = await salesClientsRepository.getSalesClientById(id);
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  return client;
}

function aliasInput(body) {
  const optionId = parseId(body.product_option_id ?? body.product_id, "INVALID_PRODUCT_OPTION_ID");
  const externalProductName = optionalText(body.external_product_name);
  const externalProductCode = optionalText(body.external_product_code);
  const externalOptionName = optionalText(body.external_option_name);
  if (!externalProductName && !externalProductCode) {
    throw new AppError("ALIAS_KEY_REQUIRED", "외부 상품명 또는 상품코드가 필요합니다.", 400);
  }
  return {
    product_option_id: optionId,
    external_product_code: externalProductCode,
    external_product_name: externalProductName,
    external_option_name: externalOptionName,
    normalized_product_code: normalizeAliasText(externalProductCode),
    normalized_product_name: normalizeAliasText(externalProductName),
    normalized_option_name: normalizeAliasText(externalOptionName),
  };
}

export async function listAliases(clientIdParam) {
  const client = await requireClient(clientIdParam);
  return { items: await productAliasesRepository.listAliases(client.id) };
}

export async function createAlias(clientIdParam, body) {
  const client = await requireClient(clientIdParam);
  const option = await orderImportsRepository.getOptionById(parseId(body.product_option_id ?? body.product_id, "INVALID_PRODUCT_OPTION_ID"));
  if (!option) {
    throw new AppError("PRODUCT_NOT_FOUND", "존재하지 않는 상품입니다.", 400);
  }
  const saved = await productAliasesRepository.upsertAlias({
    client_id: client.id,
    ...aliasInput(body),
  });
  return productAliasesRepository.getAliasById(client.id, saved.id);
}

export async function updateAlias(clientIdParam, aliasIdParam, body) {
  const client = await requireClient(clientIdParam);
  const aliasId = parseId(aliasIdParam);
  const existing = await productAliasesRepository.getAliasById(client.id, aliasId);
  if (!existing) {
    throw new AppError("ALIAS_NOT_FOUND", "상품 별칭을 찾을 수 없습니다.", 404);
  }
  const option = await orderImportsRepository.getOptionById(parseId(body.product_option_id ?? body.product_id, "INVALID_PRODUCT_OPTION_ID"));
  if (!option) {
    throw new AppError("PRODUCT_NOT_FOUND", "존재하지 않는 상품입니다.", 400);
  }
  const updated = await productAliasesRepository.updateAlias(client.id, aliasId, aliasInput({
    ...existing,
    ...body,
  }));
  return productAliasesRepository.getAliasById(client.id, updated.id);
}

export async function removeAlias(clientIdParam, aliasIdParam) {
  const client = await requireClient(clientIdParam);
  const aliasId = parseId(aliasIdParam);
  const existing = await productAliasesRepository.getAliasById(client.id, aliasId);
  if (!existing) {
    throw new AppError("ALIAS_NOT_FOUND", "상품 별칭을 찾을 수 없습니다.", 404);
  }
  await productAliasesRepository.deleteAlias(client.id, aliasId);
  await insertAuditLog({
    entity_type: "product_alias",
    entity_id: aliasId,
    action: "DELETE",
    before_data: existing,
  });
  return { deleted: true };
}

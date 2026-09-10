import { AppError } from "../../utils/app-error.js";
import {
  SETTLEMENT_TYPES,
  SHIPPING_CALC_MODES,
  SHIPPING_TYPES,
  optionalBooleanQuery,
  optionalText,
  oneOf,
  parseId,
  requiredBoolean,
  requiredText,
} from "../../utils/validation.js";
import * as salesClientsRepository from "./sales-clients.repository.js";
import { insertAuditLog } from "../audit/audit.repository.js";
import { salesClientImpact } from "../deletions/impact.repository.js";

function parseClientInput(body) {
  return {
    client_code: requiredText(body.client_code, "CLIENT_CODE_REQUIRED", "매출처코드는 필수입니다."),
    client_name: requiredText(body.client_name, "CLIENT_NAME_REQUIRED", "매출처명은 필수입니다."),
    business_number: optionalText(body.business_number),
    ceo_name: optionalText(body.ceo_name),
    address: optionalText(body.address),
    manager_name: optionalText(body.manager_name),
    phone: optionalText(body.phone),
    email: optionalText(body.email),
    default_shipping_type: oneOf(
      body.default_shipping_type ?? "PARCEL",
      SHIPPING_TYPES,
      "INVALID_SHIPPING_TYPE",
      "기본 배송방식이 올바르지 않습니다.",
    ),
    shipping_calculation_mode: oneOf(
      body.shipping_calculation_mode ?? "TOTAL_QUANTITY",
      SHIPPING_CALC_MODES,
      "INVALID_SHIPPING_CALC_MODE",
      "배송비 계산 방식이 올바르지 않습니다.",
    ),
    settlement_type: oneOf(
      body.settlement_type ?? "POSTPAID",
      SETTLEMENT_TYPES,
      "INVALID_SETTLEMENT_TYPE",
      "정산 방식이 올바르지 않습니다.",
    ),
    memo: optionalText(body.memo),
    is_active:
      body.is_active == null
        ? true
        : requiredBoolean(body.is_active, "INVALID_IS_ACTIVE", "활성여부가 올바르지 않습니다."),
  };
}

export async function listSalesClients(query) {
  const items = await salesClientsRepository.listSalesClients({
    search: optionalText(query.search),
    isActive: optionalBooleanQuery(query.is_active),
  });
  return { items };
}

export async function getSalesClient(idParam) {
  const id = parseId(idParam);
  const client = await salesClientsRepository.getSalesClientById(id);
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  return client;
}

export async function createSalesClient(body) {
  return salesClientsRepository.createSalesClient(parseClientInput(body));
}

export async function updateSalesClient(idParam, body) {
  const id = parseId(idParam);
  const existing = await salesClientsRepository.getSalesClientById(id);
  if (!existing) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  return salesClientsRepository.updateSalesClient(id, parseClientInput({ ...existing, ...body }));
}

export async function updateSalesClientStatus(idParam, body) {
  const id = parseId(idParam);
  const existing = await salesClientsRepository.getSalesClientById(id);
  if (!existing) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  const isActive = requiredBoolean(body.is_active, "INVALID_IS_ACTIVE", "활성여부가 올바르지 않습니다.");
  const updated = await salesClientsRepository.updateSalesClientStatus(id, isActive);
  await insertAuditLog({
    entity_type: "sales_client",
    entity_id: id,
    action: isActive ? "REACTIVATE" : "DEACTIVATE",
    before_data: existing,
  });
  return updated;
}

export async function getDeleteImpact(idParam) {
  const existing = await getSalesClient(idParam);
  return { id: existing.id, ...await salesClientImpact(existing.id) };
}

export async function deleteSalesClient(idParam) {
  const existing = await getSalesClient(idParam);
  const impact = await salesClientImpact(existing.id);
  if (!impact.can_delete) {
    throw new AppError("SALES_CLIENT_IN_USE", "제안가, Alias, 발주 또는 거래가 있는 매출처는 삭제할 수 없습니다.", 409, impact.references);
  }
  await salesClientsRepository.deleteSalesClient(existing.id);
  await insertAuditLog({
    entity_type: "sales_client",
    entity_id: existing.id,
    action: "DELETE",
    before_data: existing,
  });
  return { deleted: true, id: existing.id };
}

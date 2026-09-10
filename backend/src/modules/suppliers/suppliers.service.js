import { AppError } from "../../utils/app-error.js";
import {
  optionalBooleanQuery,
  optionalText,
  parseId,
  requiredBoolean,
  requiredText,
} from "../../utils/validation.js";
import * as suppliersRepository from "./suppliers.repository.js";
import { insertAuditLog } from "../audit/audit.repository.js";
import { supplierImpact } from "../deletions/impact.repository.js";

function parseSupplierInput(body) {
  const supplier_code = requiredText(body.supplier_code, "SUPPLIER_CODE_REQUIRED", "매입처코드는 필수입니다.");
  const supplier_name = requiredText(body.supplier_name, "SUPPLIER_NAME_REQUIRED", "매입처명은 필수입니다.");
  return {
    supplier_code,
    supplier_name,
    business_number: optionalText(body.business_number),
    manager_name: optionalText(body.manager_name),
    phone: optionalText(body.phone),
    email: optionalText(body.email),
    memo: optionalText(body.memo),
    is_active:
      body.is_active == null
        ? true
        : requiredBoolean(body.is_active, "INVALID_IS_ACTIVE", "활성여부가 올바르지 않습니다."),
  };
}

export async function listSuppliers(query) {
  const search = optionalText(query.search);
  const isActive = optionalBooleanQuery(query.is_active);
  const items = await suppliersRepository.listSuppliers({ search, isActive });
  return { items };
}

export async function getSupplier(idParam) {
  const id = parseId(idParam);
  const supplier = await suppliersRepository.getSupplierById(id);
  if (!supplier) {
    throw new AppError("SUPPLIER_NOT_FOUND", "매입처를 찾을 수 없습니다.", 404);
  }
  return supplier;
}

export async function createSupplier(body) {
  const input = parseSupplierInput(body);
  return suppliersRepository.createSupplier(input);
}

export async function updateSupplier(idParam, body) {
  const id = parseId(idParam);
  const existing = await suppliersRepository.getSupplierById(id);
  if (!existing) {
    throw new AppError("SUPPLIER_NOT_FOUND", "매입처를 찾을 수 없습니다.", 404);
  }
  const input = parseSupplierInput({
    ...existing,
    ...body,
  });
  return suppliersRepository.updateSupplier(id, input);
}

export async function updateSupplierStatus(idParam, body) {
  const id = parseId(idParam);
  const existing = await suppliersRepository.getSupplierById(id);
  if (!existing) {
    throw new AppError("SUPPLIER_NOT_FOUND", "매입처를 찾을 수 없습니다.", 404);
  }
  const isActive = requiredBoolean(body.is_active, "INVALID_IS_ACTIVE", "활성여부가 올바르지 않습니다.");
  const updated = await suppliersRepository.updateSupplierStatus(id, isActive);
  await insertAuditLog({
    entity_type: "supplier",
    entity_id: id,
    action: isActive ? "REACTIVATE" : "DEACTIVATE",
    before_data: existing,
  });
  return updated;
}

export async function getDeleteImpact(idParam) {
  const existing = await getSupplier(idParam);
  return { id: existing.id, ...await supplierImpact(existing.id) };
}

export async function deleteSupplier(idParam) {
  const existing = await getSupplier(idParam);
  const impact = await supplierImpact(existing.id);
  if (!impact.can_delete) {
    throw new AppError("SUPPLIER_IN_USE", "연결된 상품 또는 참조 데이터가 있어 매입처를 삭제할 수 없습니다.", 409, impact.references);
  }
  await suppliersRepository.deleteSupplier(existing.id);
  await insertAuditLog({
    entity_type: "supplier",
    entity_id: existing.id,
    action: "DELETE",
    before_data: existing,
  });
  return { deleted: true, id: existing.id };
}

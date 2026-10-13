import { AppError } from "../../utils/app-error.js";
import { optionalBooleanQuery, parseId } from "../../utils/validation.js";
import * as invoiceSuppliersRepository from "./invoice-suppliers.repository.js";

export async function listProfiles(query = {}) {
  const activeOnly = optionalBooleanQuery(query.is_active);
  const items = await invoiceSuppliersRepository.listProfiles({
    activeOnly: activeOnly === true,
  });
  return { items };
}

export async function getProfile(id) {
  const profile = await invoiceSuppliersRepository.getById(parseId(id));
  if (!profile) {
    throw new AppError("INVOICE_SUPPLIER_NOT_FOUND", "거래명세서 공급자를 찾을 수 없습니다.", 404);
  }
  return profile;
}

export async function requireActiveProfile(id) {
  const profile = await getProfile(id);
  if (!profile.is_active) {
    throw new AppError("INVOICE_SUPPLIER_INACTIVE", "비활성 공급자로는 거래명세서를 생성할 수 없습니다.", 400);
  }
  return profile;
}

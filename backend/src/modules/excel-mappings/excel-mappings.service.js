import { AppError } from "../../utils/app-error.js";
import { optionalText, parseId, requiredInt } from "../../utils/validation.js";
import { sanitizeColumnMap, sanitizeMappingMeta } from "../../domain/excel-mapping.js";
import { MAPPING_FIELDS } from "../../domain/excel-mapping.js";
import { assertHeaderRange, headerRangeFromRecord } from "../../domain/excel-headers.js";
import * as salesClientsRepository from "../sales-clients/sales-clients.repository.js";
import * as excelMappingsRepository from "./excel-mappings.repository.js";
import { insertAuditLog } from "../audit/audit.repository.js";

export { MAPPING_FIELDS };

async function requireClient(idParam) {
  const id = parseId(idParam);
  const client = await salesClientsRepository.getSalesClientById(id);
  if (!client) {
    throw new AppError("CLIENT_NOT_FOUND", "매출처를 찾을 수 없습니다.", 404);
  }
  return client;
}

export async function getMapping(clientIdParam) {
  const client = await requireClient(clientIdParam);
  const mapping = await excelMappingsRepository.getActiveMapping(client.id);
  return {
    fields: MAPPING_FIELDS,
    mapping,
  };
}

export async function saveMapping(clientIdParam, body) {
  const client = await requireClient(clientIdParam);
  const existing = await excelMappingsRepository.getActiveMapping(client.id);
  const range = assertHeaderRange(
    headerRangeFromRecord(
      {
        header_start_row: body.header_start_row ?? existing?.header_start_row,
        header_end_row: body.header_end_row ?? existing?.header_end_row,
        data_start_row: body.data_start_row ?? existing?.data_start_row,
        header_row_number: body.header_row_number ?? existing?.header_row_number ?? 1,
      },
      { headerStartRow: 1, headerEndRow: 1, dataStartRow: 2 },
    ),
  );
  if (body.header_row_number != null && body.header_start_row == null && body.header_end_row == null) {
    const n = requiredInt(body.header_row_number, {
      min: 1,
      code: "INVALID_HEADER_ROW",
      message: "헤더 행 번호는 1 이상의 정수여야 합니다.",
    });
    range.headerStartRow = n;
    range.headerEndRow = n;
    range.dataStartRow = n + 1;
  }
  const mapping = await excelMappingsRepository.upsertActiveMapping(client.id, {
    mapping_name: optionalText(body.mapping_name) || "default",
    sheet_name: optionalText(body.sheet_name),
    header_row_number: range.headerEndRow,
    header_start_row: range.headerStartRow,
    header_end_row: range.headerEndRow,
    data_start_row: range.dataStartRow,
    column_map: sanitizeColumnMap(body.column_map || body),
    mapping_meta: sanitizeMappingMeta(body.mapping_meta || {}),
  });
  return { fields: MAPPING_FIELDS, mapping };
}

export async function deleteMapping(clientIdParam, mappingIdParam) {
  const client = await requireClient(clientIdParam);
  const mapping = mappingIdParam
    ? await excelMappingsRepository.getMappingById(parseId(mappingIdParam))
    : await excelMappingsRepository.getActiveMapping(client.id);
  if (!mapping || mapping.client_id !== client.id) {
    throw new AppError("MAPPING_NOT_FOUND", "Excel Mapping을 찾을 수 없습니다.", 404);
  }
  await excelMappingsRepository.deleteMapping(mapping.id);
  await insertAuditLog({
    entity_type: "excel_mapping",
    entity_id: mapping.id,
    action: "DELETE",
    before_data: mapping,
  });
  return { deleted: true, id: mapping.id };
}

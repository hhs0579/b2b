import { pool } from "../../db/pool.js";
import { rethrowDatabaseError } from "../../utils/db-errors.js";
import { toPublicId } from "../../utils/validation.js";

function mapMapping(row) {
  return {
    id: toPublicId(row.id),
    client_id: toPublicId(row.client_id),
    mapping_name: row.mapping_name,
    sheet_name: row.sheet_name,
    header_row_number: row.header_row_number,
    header_start_row: row.header_start_row ?? row.header_row_number ?? 1,
    header_end_row: row.header_end_row ?? row.header_row_number ?? 1,
    data_start_row: row.data_start_row ?? (row.header_end_row ?? row.header_row_number ?? 1) + 1,
    column_map: row.column_map || {},
    mapping_meta: row.mapping_meta || {},
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getActiveMapping(clientId, db = pool) {
  const { rows } = await db.query(
    `
      SELECT id, client_id, mapping_name, sheet_name, header_row_number,
             header_start_row, header_end_row, data_start_row, column_map, mapping_meta,
             is_active, created_at, updated_at
      FROM excel_mappings
      WHERE client_id = $1 AND is_active = TRUE
      ORDER BY id DESC
      LIMIT 1
    `,
    [clientId],
  );
  return rows[0] ? mapMapping(rows[0]) : null;
}

export async function upsertActiveMapping(clientId, input, db = pool) {
  try {
    const existing = await getActiveMapping(clientId, db);
    if (existing) {
      const { rows } = await db.query(
        `
          UPDATE excel_mappings
          SET
            mapping_name = $2,
            sheet_name = $3,
            header_row_number = $4,
            header_start_row = $5,
            header_end_row = $6,
            data_start_row = $7,
            column_map = $8::jsonb,
            mapping_meta = $9::jsonb,
            updated_at = NOW()
          WHERE id = $1
          RETURNING id, client_id, mapping_name, sheet_name, header_row_number,
                    header_start_row, header_end_row, data_start_row, column_map, mapping_meta,
                    is_active, created_at, updated_at
        `,
        [
          existing.id,
          input.mapping_name || existing.mapping_name,
          input.sheet_name,
          input.header_row_number,
          input.header_start_row ?? input.header_row_number ?? 1,
          input.header_end_row ?? input.header_row_number ?? 1,
          input.data_start_row ?? (input.header_end_row ?? input.header_row_number ?? 1) + 1,
          JSON.stringify(input.column_map || {}),
          JSON.stringify(input.mapping_meta || {}),
        ],
      );
      return mapMapping(rows[0]);
    }
    const { rows } = await db.query(
      `
        INSERT INTO excel_mappings (
          client_id, mapping_name, sheet_name, header_row_number,
          header_start_row, header_end_row, data_start_row, column_map, mapping_meta, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, TRUE)
        RETURNING id, client_id, mapping_name, sheet_name, header_row_number,
                  header_start_row, header_end_row, data_start_row, column_map, mapping_meta,
                  is_active, created_at, updated_at
      `,
      [
        clientId,
        input.mapping_name || "default",
        input.sheet_name,
        input.header_row_number,
        input.header_start_row ?? input.header_row_number ?? 1,
        input.header_end_row ?? input.header_row_number ?? 1,
        input.data_start_row ?? (input.header_end_row ?? input.header_row_number ?? 1) + 1,
        JSON.stringify(input.column_map || {}),
        JSON.stringify(input.mapping_meta || {}),
      ],
    );
    return mapMapping(rows[0]);
  } catch (err) {
    rethrowDatabaseError(err);
  }
}

export async function getMappingById(id, db = pool) {
  const { rows } = await db.query(
    `
      SELECT id, client_id, mapping_name, sheet_name, header_row_number,
             header_start_row, header_end_row, data_start_row, column_map, mapping_meta,
             is_active, created_at, updated_at
      FROM excel_mappings
      WHERE id = $1
    `,
    [id],
  );
  return rows[0] ? mapMapping(rows[0]) : null;
}

export async function deleteMapping(id, db = pool) {
  const { rowCount } = await db.query(`DELETE FROM excel_mappings WHERE id = $1`, [id]);
  return rowCount > 0;
}

export async function deleteActiveMapping(clientId, db = pool) {
  const existing = await getActiveMapping(clientId, db);
  if (!existing) {
    return null;
  }
  await deleteMapping(existing.id, db);
  return existing;
}

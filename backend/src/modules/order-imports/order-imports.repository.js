import { pool } from "../../db/pool.js";
import { rethrowDatabaseError } from "../../utils/db-errors.js";
import { toIsoDate } from "../../domain/dates.js";
import { toPublicId } from "../../utils/validation.js";

function mapImport(row, { includePath = false } = {}) {
  const mapped = {
    id: toPublicId(row.id),
    client_id: toPublicId(row.client_id),
    client_code: row.client_code ?? undefined,
    client_name: row.client_name ?? undefined,
    order_date: toIsoDate(row.order_date),
    original_file_name: row.original_file_name,
    stored_file_name: row.stored_file_name,
    file_hash: row.file_hash,
    file_size: row.file_size,
    sheet_name: row.sheet_name,
    header_row_number: row.header_row_number,
    header_start_row: row.header_start_row ?? row.header_row_number ?? 1,
    header_end_row: row.header_end_row ?? row.header_row_number ?? 1,
    data_start_row:
      row.data_start_row ?? (row.header_end_row ?? row.header_row_number ?? 1) + 1,
    column_map: row.column_map || null,
    mapping_meta: row.mapping_meta || {},
    status: row.status,
    duplicate_hash_detected: row.duplicate_hash_detected,
    duplicate_acknowledged: row.duplicate_acknowledged,
    source_row_count: row.source_row_count,
    parsed_row_count: row.parsed_row_count,
    valid_row_count: row.valid_row_count,
    invalid_row_count: row.invalid_row_count,
    matched_row_count: row.matched_row_count,
    unmatched_row_count: row.unmatched_row_count,
    error_message: row.error_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includePath) {
    mapped.stored_file_path = row.stored_file_path;
  }
  return mapped;
}

function mapRow(row) {
  return {
    id: toPublicId(row.id),
    order_import_id: toPublicId(row.order_import_id),
    source_sheet_name: row.source_sheet_name,
    source_row_number: row.source_row_number,
    external_order_number: row.external_order_number,
    external_product_code: row.external_product_code,
    external_product_name: row.external_product_name,
    external_option_name: row.external_option_name,
    parsed_quantity: row.parsed_quantity == null ? null : row.parsed_quantity,
    manual_quantity: row.manual_quantity == null ? null : row.manual_quantity,
    quantity_source: row.quantity_source || "PARSED",
    quantity: row.quantity,
    recipient_name: row.recipient_name,
    phone: row.phone,
    address: row.address,
    shipping_memo: row.shipping_memo,
    matched_product_id: row.matched_product_id == null ? null : toPublicId(row.matched_product_id),
    matched_product_option_id:
      row.matched_product_option_id == null ? null : toPublicId(row.matched_product_option_id),
    product_code: row.product_code ?? null,
    product_name: row.product_name ?? null,
    option_name: row.option_name ?? null,
    product_is_active: row.product_is_active ?? null,
    match_status: row.match_status,
    validation_status: row.validation_status,
    validation_errors: row.validation_errors || [],
    raw_row_json: row.raw_row_json || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const IMPORT_COLUMNS = `
  i.id, i.client_id, c.client_code, c.client_name, i.order_date,
  i.original_file_name, i.stored_file_name, i.stored_file_path, i.file_hash, i.file_size,
  i.sheet_name, i.header_row_number, i.header_start_row, i.header_end_row, i.data_start_row,
  i.column_map, i.mapping_meta, i.status,
  i.duplicate_hash_detected, i.duplicate_acknowledged,
  i.source_row_count, i.parsed_row_count, i.valid_row_count, i.invalid_row_count,
  i.matched_row_count, i.unmatched_row_count, i.error_message, i.created_at, i.updated_at
`;

export async function listImports({ clientId, status }) {
  const where = [];
  const params = [];
  if (clientId != null) {
    params.push(clientId);
    where.push(`i.client_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`i.status = $${params.length}`);
  }
  const { rows } = await pool.query(
    `
      SELECT ${IMPORT_COLUMNS}
      FROM order_imports i
      INNER JOIN sales_clients c ON c.id = i.client_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY i.id DESC
      LIMIT 200
    `,
    params,
  );
  return rows.map((row) => mapImport(row));
}

export async function getImportById(id, db = pool) {
  const { rows } = await db.query(
    `
      SELECT ${IMPORT_COLUMNS}
      FROM order_imports i
      INNER JOIN sales_clients c ON c.id = i.client_id
      WHERE i.id = $1
    `,
    [id],
  );
  return rows[0] ? mapImport(rows[0], { includePath: true }) : null;
}

export async function findDuplicateHash(clientId, fileHash, excludeId, db = pool) {
  const params = [clientId, fileHash];
  let sql = `
    SELECT id FROM order_imports
    WHERE client_id = $1 AND file_hash = $2
  `;
  if (excludeId) {
    params.push(excludeId);
    sql += ` AND id <> $3`;
  }
  sql += ` ORDER BY id DESC LIMIT 1`;
  const { rows } = await db.query(sql, params);
  return rows[0] ? toPublicId(rows[0].id) : null;
}

export async function insertImport(input, db = pool) {
  try {
    const { rows } = await db.query(
      `
        INSERT INTO order_imports (
          client_id, order_date, original_file_name, stored_file_name, stored_file_path,
          file_hash, file_size, sheet_name, header_row_number, header_start_row, header_end_row,
          data_start_row, column_map, mapping_meta, status,
          duplicate_hash_detected, duplicate_acknowledged
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17)
        RETURNING id
      `,
      [
        input.client_id,
        input.order_date,
        input.original_file_name,
        input.stored_file_name,
        input.stored_file_path,
        input.file_hash,
        input.file_size,
        input.sheet_name,
        input.header_row_number,
        input.header_start_row ?? input.header_row_number ?? 1,
        input.header_end_row ?? input.header_row_number ?? 1,
        input.data_start_row ?? (input.header_end_row ?? input.header_row_number ?? 1) + 1,
        input.column_map ? JSON.stringify(input.column_map) : null,
        JSON.stringify(input.mapping_meta || {}),
        input.status,
        input.duplicate_hash_detected,
        input.duplicate_acknowledged,
      ],
    );
    return getImportById(toPublicId(rows[0].id), db);
  } catch (err) {
    rethrowDatabaseError(err);
  }
}

export async function updateImport(id, patch, db = pool) {
  const fields = [];
  const params = [];
  const assign = (column, value, cast = "") => {
    params.push(value);
    fields.push(`${column} = $${params.length}${cast}`);
  };
  if (patch.sheet_name !== undefined) assign("sheet_name", patch.sheet_name);
  if (patch.header_row_number !== undefined) assign("header_row_number", patch.header_row_number);
  if (patch.header_start_row !== undefined) assign("header_start_row", patch.header_start_row);
  if (patch.header_end_row !== undefined) assign("header_end_row", patch.header_end_row);
  if (patch.data_start_row !== undefined) assign("data_start_row", patch.data_start_row);
  if (patch.column_map !== undefined) {
    assign("column_map", patch.column_map == null ? null : JSON.stringify(patch.column_map), "::jsonb");
  }
  if (patch.mapping_meta !== undefined) {
    assign("mapping_meta", JSON.stringify(patch.mapping_meta || {}), "::jsonb");
  }
  if (patch.status !== undefined) assign("status", patch.status);
  if (patch.duplicate_acknowledged !== undefined) assign("duplicate_acknowledged", patch.duplicate_acknowledged);
  if (patch.source_row_count !== undefined) assign("source_row_count", patch.source_row_count);
  if (patch.parsed_row_count !== undefined) assign("parsed_row_count", patch.parsed_row_count);
  if (patch.valid_row_count !== undefined) assign("valid_row_count", patch.valid_row_count);
  if (patch.invalid_row_count !== undefined) assign("invalid_row_count", patch.invalid_row_count);
  if (patch.matched_row_count !== undefined) assign("matched_row_count", patch.matched_row_count);
  if (patch.unmatched_row_count !== undefined) assign("unmatched_row_count", patch.unmatched_row_count);
  if (patch.error_message !== undefined) assign("error_message", patch.error_message);
  if (fields.length === 0) {
    return getImportById(id, db);
  }
  fields.push("updated_at = NOW()");
  params.push(id);
  await db.query(
    `UPDATE order_imports SET ${fields.join(", ")} WHERE id = $${params.length}`,
    params,
  );
  return getImportById(id, db);
}

export async function deleteImportRows(importId, db = pool) {
  await db.query(`DELETE FROM order_import_rows WHERE order_import_id = $1`, [importId]);
}

export async function deleteImport(id, db = pool) {
  const { rowCount } = await db.query(`DELETE FROM order_imports WHERE id = $1`, [id]);
  return rowCount > 0;
}

export async function insertImportRows(importId, rows, db = pool) {
  for (const row of rows) {
    await db.query(
      `
        INSERT INTO order_import_rows (
          order_import_id, source_sheet_name, source_row_number,
          external_order_number, external_product_code, external_product_name, external_option_name,
          quantity, parsed_quantity, manual_quantity, quantity_source,
          recipient_name, phone, address, shipping_memo,
          matched_product_option_id, match_status, validation_status, validation_errors, raw_row_json
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb)
      `,
      [
        importId,
        row.source_sheet_name,
        row.source_row_number,
        row.external_order_number,
        row.external_product_code,
        row.external_product_name,
        row.external_option_name,
        row.quantity,
        row.parsed_quantity ?? null,
        row.manual_quantity ?? null,
        row.quantity_source || "PARSED",
        row.recipient_name,
        row.phone,
        row.address,
        row.shipping_memo,
        row.matched_product_option_id,
        row.match_status,
        row.validation_status,
        JSON.stringify(row.validation_errors || []),
        JSON.stringify(row.raw_row_json || {}),
      ],
    );
  }
}

export async function listImportRows(importId, db = pool) {
  const { rows } = await db.query(
    `
      SELECT
        r.*,
        o.product_code, p.product_name, o.option_name,
        (p.is_active AND o.is_active) AS product_is_active,
        o.product_id AS matched_product_id
      FROM order_import_rows r
      LEFT JOIN product_options o ON o.id = r.matched_product_option_id
      LEFT JOIN products p ON p.id = o.product_id
      WHERE r.order_import_id = $1
      ORDER BY r.source_row_number ASC
    `,
    [importId],
  );
  return rows.map(mapRow);
}

export async function getImportRow(importId, rowId, db = pool) {
  const { rows } = await db.query(
    `
      SELECT
        r.*,
        o.product_code, p.product_name, o.option_name,
        (p.is_active AND o.is_active) AS product_is_active,
        o.product_id AS matched_product_id
      FROM order_import_rows r
      LEFT JOIN product_options o ON o.id = r.matched_product_option_id
      LEFT JOIN products p ON p.id = o.product_id
      WHERE r.order_import_id = $1 AND r.id = $2
    `,
    [importId, rowId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function updateImportRowMatch(importId, rowId, patch, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE order_import_rows
      SET
        matched_product_option_id = $3,
        match_status = $4,
        validation_status = $5,
        validation_errors = $6::jsonb,
        updated_at = NOW()
      WHERE order_import_id = $1 AND id = $2
      RETURNING id
    `,
    [
      importId,
      rowId,
      patch.matched_product_option_id,
      patch.match_status,
      patch.validation_status,
      JSON.stringify(patch.validation_errors || []),
    ],
  );
  if (!rows[0]) {
    return null;
  }
  return getImportRow(importId, rowId, db);
}

export async function updateImportRowQuantity(importId, rowId, patch, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE order_import_rows
      SET
        quantity = $3,
        parsed_quantity = $4,
        manual_quantity = $5,
        quantity_source = $6,
        validation_status = $7,
        validation_errors = $8::jsonb,
        updated_at = NOW()
      WHERE order_import_id = $1 AND id = $2
      RETURNING id
    `,
    [
      importId,
      rowId,
      patch.quantity,
      patch.parsed_quantity,
      patch.manual_quantity,
      patch.quantity_source,
      patch.validation_status,
      JSON.stringify(patch.validation_errors || []),
    ],
  );
  if (!rows[0]) {
    return null;
  }
  return getImportRow(importId, rowId, db);
}

export async function listProductsForMatch(db = pool) {
  const { rows } = await db.query(
    `
      SELECT
        o.id, o.product_id, o.product_code, o.barcode, p.product_name, o.option_name,
        o.purchase_price, o.carton_qty, o.default_shipping_fee,
        (p.is_active AND o.is_active) AS is_active
      FROM product_options o
      INNER JOIN products p ON p.id = o.product_id
    `,
  );
  return rows.map((row) => ({
    id: toPublicId(row.id),
    product_id: toPublicId(row.product_id),
    product_code: row.product_code,
    barcode: row.barcode ?? null,
    product_name: row.product_name,
    option_name: row.option_name,
    purchase_price: row.purchase_price,
    carton_qty: row.carton_qty,
    default_shipping_fee: row.default_shipping_fee,
    is_active: row.is_active,
  }));
}

export async function getOptionById(optionId, db = pool) {
  const { rows } = await db.query(
    `
      SELECT
        o.id, o.product_id, o.product_code, p.product_name, o.option_name,
        o.purchase_price, o.carton_qty, o.default_shipping_fee,
        (p.is_active AND o.is_active) AS is_active
      FROM product_options o
      INNER JOIN products p ON p.id = o.product_id
      WHERE o.id = $1
    `,
    [optionId],
  );
  if (!rows[0]) {
    return null;
  }
  return {
    id: toPublicId(rows[0].id),
    product_id: toPublicId(rows[0].product_id),
    product_code: rows[0].product_code,
    product_name: rows[0].product_name,
    option_name: rows[0].option_name,
    purchase_price: rows[0].purchase_price,
    carton_qty: rows[0].carton_qty,
    default_shipping_fee: rows[0].default_shipping_fee,
    is_active: rows[0].is_active,
  };
}

export async function getProductById(productId, db = pool) {
  return getOptionById(productId, db);
}

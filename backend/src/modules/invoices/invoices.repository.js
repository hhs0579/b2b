import { pool } from "../../db/pool.js";
import { toPublicId } from "../../utils/validation.js";

function mapDocument(row) {
  return {
    id: toPublicId(row.id),
    order_id: toPublicId(row.order_id),
    document_type: row.document_type,
    version: row.version,
    original_file_name: row.original_file_name,
    stored_file_name: row.stored_file_name,
    file_hash: row.file_hash,
    file_size: row.file_size,
    template_hash: row.template_hash,
    status: row.status,
    invoice_metadata_snapshot: row.invoice_metadata_snapshot ?? null,
    created_at: row.created_at,
  };
}

export async function listByOrderId(orderId, db = pool) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM generated_documents
      WHERE order_id = $1 AND document_type = 'INVOICE'
      ORDER BY version ASC
    `,
    [orderId],
  );
  return rows.map(mapDocument);
}

export async function getById(id, db = pool) {
  const { rows } = await db.query(`SELECT * FROM generated_documents WHERE id = $1`, [id]);
  return rows[0] ? mapDocument(rows[0]) : null;
}

export async function nextVersion(orderId, db = pool) {
  const { rows } = await db.query(
    `
      SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM generated_documents
      WHERE order_id = $1 AND document_type = 'INVOICE'
    `,
    [orderId],
  );
  return rows[0].version;
}

/** 새 버전은 항상 GENERATED로 추가한다. 기존 버전을 SUPERSEDED로 바꾸지 않는다. */
export async function insertGenerated(input, db = pool) {
  const { rows } = await db.query(
    `
      INSERT INTO generated_documents (
        order_id, document_type, version, original_file_name, stored_file_name,
        file_hash, file_size, template_hash, status, invoice_metadata_snapshot
      )
      VALUES ($1,'INVOICE',$2,$3,$4,$5,$6,$7,'GENERATED',$8)
      RETURNING *
    `,
    [
      input.order_id,
      input.version,
      input.original_file_name,
      input.stored_file_name,
      input.file_hash,
      input.file_size,
      input.template_hash,
      input.invoice_metadata_snapshot ?? null,
    ],
  );
  return mapDocument(rows[0]);
}

export async function markInvalid(id, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE generated_documents
      SET status = 'INVALID'
      WHERE id = $1 AND document_type = 'INVOICE'
      RETURNING *
    `,
    [id],
  );
  return rows[0] ? mapDocument(rows[0]) : null;
}

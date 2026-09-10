import { pool } from "../../db/pool.js";
import { rethrowDatabaseError } from "../../utils/db-errors.js";
import { toPublicId } from "../../utils/validation.js";

function mapSupplier(row) {
  return {
    id: toPublicId(row.id),
    supplier_code: row.supplier_code,
    supplier_name: row.supplier_name,
    business_number: row.business_number,
    manager_name: row.manager_name,
    phone: row.phone,
    email: row.email,
    memo: row.memo,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listSuppliers({ search, isActive }) {
  const where = [];
  const params = [];

  if (search) {
    params.push(search);
    where.push(
      `(strpos(lower(supplier_code), lower($${params.length})) > 0 OR strpos(lower(supplier_name), lower($${params.length})) > 0)`,
    );
  }

  if (isActive !== undefined) {
    params.push(isActive);
    where.push(`is_active = $${params.length}`);
  }

  const sql = `
    SELECT id, supplier_code, supplier_name, business_number, manager_name, phone, email, memo, is_active, created_at, updated_at
    FROM suppliers
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY supplier_code ASC
  `;

  const { rows } = await pool.query(sql, params);
  return rows.map(mapSupplier);
}

export async function getSupplierById(id) {
  const { rows } = await pool.query(
    `
      SELECT id, supplier_code, supplier_name, business_number, manager_name, phone, email, memo, is_active, created_at, updated_at
      FROM suppliers
      WHERE id = $1
    `,
    [id],
  );
  return rows[0] ? mapSupplier(rows[0]) : null;
}

export async function createSupplier(input) {
  try {
    const { rows } = await pool.query(
      `
        INSERT INTO suppliers (
          supplier_code, supplier_name, business_number, manager_name, phone, email, memo, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, supplier_code, supplier_name, business_number, manager_name, phone, email, memo, is_active, created_at, updated_at
      `,
      [
        input.supplier_code,
        input.supplier_name,
        input.business_number,
        input.manager_name,
        input.phone,
        input.email,
        input.memo,
        input.is_active,
      ],
    );
    return mapSupplier(rows[0]);
  } catch (err) {
    rethrowDatabaseError(err);
  }
}

export async function updateSupplier(id, input) {
  try {
    const { rows } = await pool.query(
      `
        UPDATE suppliers
        SET
          supplier_code = $2,
          supplier_name = $3,
          business_number = $4,
          manager_name = $5,
          phone = $6,
          email = $7,
          memo = $8,
          is_active = $9,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, supplier_code, supplier_name, business_number, manager_name, phone, email, memo, is_active, created_at, updated_at
      `,
      [
        id,
        input.supplier_code,
        input.supplier_name,
        input.business_number,
        input.manager_name,
        input.phone,
        input.email,
        input.memo,
        input.is_active,
      ],
    );
    return rows[0] ? mapSupplier(rows[0]) : null;
  } catch (err) {
    rethrowDatabaseError(err);
  }
}

export async function updateSupplierStatus(id, isActive) {
  const { rows } = await pool.query(
    `
      UPDATE suppliers
      SET is_active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, supplier_code, supplier_name, business_number, manager_name, phone, email, memo, is_active, created_at, updated_at
    `,
    [id, isActive],
  );
  return rows[0] ? mapSupplier(rows[0]) : null;
}

export async function deleteSupplier(id, db = pool) {
  const { rowCount } = await db.query(`DELETE FROM suppliers WHERE id = $1`, [id]);
  return rowCount > 0;
}

import { pool } from "../../db/pool.js";
import { rethrowDatabaseError } from "../../utils/db-errors.js";
import { toPublicId } from "../../utils/validation.js";

function mapClient(row) {
  return {
    id: toPublicId(row.id),
    client_code: row.client_code,
    client_name: row.client_name,
    business_number: row.business_number,
    ceo_name: row.ceo_name,
    address: row.address,
    manager_name: row.manager_name,
    phone: row.phone,
    email: row.email,
    default_shipping_type: row.default_shipping_type,
    shipping_calculation_mode: row.shipping_calculation_mode,
    settlement_type: row.settlement_type,
    memo: row.memo,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id, client_code, client_name, business_number, ceo_name, address,
  manager_name, phone, email, default_shipping_type, shipping_calculation_mode,
  settlement_type, memo, is_active, created_at, updated_at
`;

export async function listSalesClients({ search, isActive }) {
  const where = [];
  const params = [];

  if (search) {
    params.push(search);
    where.push(`(
      strpos(lower(client_code), lower($${params.length})) > 0
      OR strpos(lower(client_name), lower($${params.length})) > 0
      OR strpos(lower(COALESCE(business_number, '')), lower($${params.length})) > 0
      OR strpos(lower(COALESCE(manager_name, '')), lower($${params.length})) > 0
    )`);
  }

  if (isActive !== undefined) {
    params.push(isActive);
    where.push(`is_active = $${params.length}`);
  }

  const { rows } = await pool.query(
    `
      SELECT ${SELECT_COLUMNS}
      FROM sales_clients
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY client_code ASC
    `,
    params,
  );
  return rows.map(mapClient);
}

export async function getSalesClientById(id, client = pool) {
  const { rows } = await client.query(
    `SELECT ${SELECT_COLUMNS} FROM sales_clients WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapClient(rows[0]) : null;
}

export async function createSalesClient(input) {
  try {
    const { rows } = await pool.query(
      `
        INSERT INTO sales_clients (
          client_code, client_name, business_number, ceo_name, address,
          manager_name, phone, email, default_shipping_type, shipping_calculation_mode,
          settlement_type, memo, is_active
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING ${SELECT_COLUMNS}
      `,
      [
        input.client_code,
        input.client_name,
        input.business_number,
        input.ceo_name,
        input.address,
        input.manager_name,
        input.phone,
        input.email,
        input.default_shipping_type,
        input.shipping_calculation_mode,
        input.settlement_type,
        input.memo,
        input.is_active,
      ],
    );
    return mapClient(rows[0]);
  } catch (err) {
    rethrowDatabaseError(err);
  }
}

export async function updateSalesClient(id, input) {
  try {
    const { rows } = await pool.query(
      `
        UPDATE sales_clients
        SET
          client_code = $2,
          client_name = $3,
          business_number = $4,
          ceo_name = $5,
          address = $6,
          manager_name = $7,
          phone = $8,
          email = $9,
          default_shipping_type = $10,
          shipping_calculation_mode = $11,
          settlement_type = $12,
          memo = $13,
          is_active = $14,
          updated_at = NOW()
        WHERE id = $1
        RETURNING ${SELECT_COLUMNS}
      `,
      [
        id,
        input.client_code,
        input.client_name,
        input.business_number,
        input.ceo_name,
        input.address,
        input.manager_name,
        input.phone,
        input.email,
        input.default_shipping_type,
        input.shipping_calculation_mode,
        input.settlement_type,
        input.memo,
        input.is_active,
      ],
    );
    return rows[0] ? mapClient(rows[0]) : null;
  } catch (err) {
    rethrowDatabaseError(err);
  }
}

export async function updateSalesClientStatus(id, isActive) {
  const { rows } = await pool.query(
    `
      UPDATE sales_clients
      SET is_active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING ${SELECT_COLUMNS}
    `,
    [id, isActive],
  );
  return rows[0] ? mapClient(rows[0]) : null;
}

export async function deleteSalesClient(id, db = pool) {
  const { rowCount } = await db.query(`DELETE FROM sales_clients WHERE id = $1`, [id]);
  return rowCount > 0;
}

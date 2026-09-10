import { pool } from "../../db/pool.js";
import { rethrowDatabaseError } from "../../utils/db-errors.js";
import { toPublicId } from "../../utils/validation.js";

function mapAlias(row) {
  return {
    id: toPublicId(row.id),
    client_id: toPublicId(row.client_id),
    external_product_code: row.external_product_code,
    external_product_name: row.external_product_name,
    external_option_name: row.external_option_name,
    normalized_product_code: row.normalized_product_code,
    normalized_product_name: row.normalized_product_name,
    normalized_option_name: row.normalized_option_name,
    product_option_id: toPublicId(row.product_option_id),
    product_id: row.product_id == null ? undefined : toPublicId(row.product_id),
    product_code: row.product_code ?? null,
    product_name: row.product_name ?? undefined,
    option_name: row.option_name ?? undefined,
    is_active: row.is_active ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const SELECT_JOIN = `
  a.id, a.client_id, a.external_product_code, a.external_product_name, a.external_option_name,
  a.normalized_product_code, a.normalized_product_name, a.normalized_option_name,
  a.product_option_id, o.product_id, o.product_code, o.option_name,
  p.product_name, (p.is_active AND o.is_active) AS is_active,
  a.created_at, a.updated_at
`;

export async function listAliases(clientId) {
  const { rows } = await pool.query(
    `
      SELECT ${SELECT_JOIN}
      FROM product_aliases a
      INNER JOIN product_options o ON o.id = a.product_option_id
      INNER JOIN products p ON p.id = o.product_id
      WHERE a.client_id = $1
      ORDER BY a.id DESC
    `,
    [clientId],
  );
  return rows.map(mapAlias);
}

export async function listAliasesForMatch(clientId, db = pool) {
  const { rows } = await db.query(
    `
      SELECT
        a.normalized_product_code, a.normalized_product_name, a.normalized_option_name,
        a.product_option_id, o.product_id, (p.is_active AND o.is_active) AS is_active
      FROM product_aliases a
      INNER JOIN product_options o ON o.id = a.product_option_id
      INNER JOIN products p ON p.id = o.product_id
      WHERE a.client_id = $1
    `,
    [clientId],
  );
  return rows.map((row) => ({
    key: `${row.normalized_product_code}|${row.normalized_product_name}|${row.normalized_option_name}`,
    product_option_id: toPublicId(row.product_option_id),
    product_id: toPublicId(row.product_id),
    is_active: row.is_active,
  }));
}

export async function getAliasById(clientId, aliasId) {
  const { rows } = await pool.query(
    `
      SELECT ${SELECT_JOIN}
      FROM product_aliases a
      INNER JOIN product_options o ON o.id = a.product_option_id
      INNER JOIN products p ON p.id = o.product_id
      WHERE a.client_id = $1 AND a.id = $2
    `,
    [clientId, aliasId],
  );
  return rows[0] ? mapAlias(rows[0]) : null;
}

export async function upsertAlias(input, db = pool) {
  try {
    const { rows } = await db.query(
      `
        INSERT INTO product_aliases (
          client_id, external_product_code, external_product_name, external_option_name,
          normalized_product_code, normalized_product_name, normalized_option_name, product_option_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (client_id, normalized_product_code, normalized_product_name, normalized_option_name)
        DO UPDATE SET
          external_product_code = EXCLUDED.external_product_code,
          external_product_name = EXCLUDED.external_product_name,
          external_option_name = EXCLUDED.external_option_name,
          product_option_id = EXCLUDED.product_option_id,
          updated_at = NOW()
        RETURNING id, client_id, external_product_code, external_product_name, external_option_name,
          normalized_product_code, normalized_product_name, normalized_option_name, product_option_id, created_at, updated_at
      `,
      [
        input.client_id,
        input.external_product_code,
        input.external_product_name,
        input.external_option_name,
        input.normalized_product_code,
        input.normalized_product_name,
        input.normalized_option_name,
        input.product_option_id,
      ],
    );
    return mapAlias(rows[0]);
  } catch (err) {
    rethrowDatabaseError(err);
  }
}

export async function updateAlias(clientId, aliasId, input) {
  try {
    const { rows } = await db.query(
      `
        UPDATE product_aliases
        SET
          external_product_code = $3,
          external_product_name = $4,
          external_option_name = $5,
          normalized_product_code = $6,
          normalized_product_name = $7,
          normalized_option_name = $8,
          product_option_id = $9,
          updated_at = NOW()
        WHERE client_id = $1 AND id = $2
        RETURNING id, client_id, external_product_code, external_product_name, external_option_name,
          normalized_product_code, normalized_product_name, normalized_option_name, product_option_id, created_at, updated_at
      `,
      [
        clientId,
        aliasId,
        input.external_product_code,
        input.external_product_name,
        input.external_option_name,
        input.normalized_product_code,
        input.normalized_product_name,
        input.normalized_option_name,
        input.product_option_id,
      ],
    );
    return rows[0] ? mapAlias(rows[0]) : null;
  } catch (err) {
    rethrowDatabaseError(err);
  }
}

export async function deleteAlias(clientId, aliasId) {
  const { rowCount } = await pool.query(
    `DELETE FROM product_aliases WHERE client_id = $1 AND id = $2`,
    [clientId, aliasId],
  );
  return rowCount > 0;
}

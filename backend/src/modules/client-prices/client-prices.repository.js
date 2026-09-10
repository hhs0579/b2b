import { pool } from "../../db/pool.js";
import { addDaysIso, toIsoDate } from "../../domain/dates.js";
import { rethrowDatabaseError } from "../../utils/db-errors.js";
import { toPublicId } from "../../utils/validation.js";

function mapPrice(row) {
  return {
    id: toPublicId(row.id),
    client_id: toPublicId(row.client_id),
    product_option_id: toPublicId(row.product_option_id),
    product_id: row.product_id == null ? undefined : toPublicId(row.product_id),
    product_code: row.product_code ?? null,
    product_name: row.product_name ?? undefined,
    option_name: row.option_name ?? undefined,
    sale_price: row.sale_price,
    shipping_fee_override: row.shipping_fee_override,
    effective_from: toIsoDate(row.effective_from),
    effective_to: toIsoDate(row.effective_to),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const PRICE_JOIN = `
  cpp.id, cpp.client_id, cpp.product_option_id, cpp.sale_price, cpp.shipping_fee_override,
  cpp.effective_from, cpp.effective_to, cpp.created_at, cpp.updated_at,
  o.product_id, o.product_code, o.option_name, p.product_name
`;

export async function listPriceHistory(clientId) {
  const { rows } = await pool.query(
    `
      SELECT ${PRICE_JOIN}
      FROM client_product_prices cpp
      INNER JOIN product_options o ON o.id = cpp.product_option_id
      INNER JOIN products p ON p.id = o.product_id
      WHERE cpp.client_id = $1
      ORDER BY p.product_name ASC, o.option_name ASC NULLS FIRST, cpp.effective_from ASC, cpp.id ASC
    `,
    [clientId],
  );
  return rows.map(mapPrice);
}

export async function listPricesForProductForUpdate(client, clientId, productOptionId) {
  const { rows } = await client.query(
    `
      SELECT id, client_id, product_option_id, sale_price, shipping_fee_override, effective_from, effective_to
      FROM client_product_prices
      WHERE client_id = $1 AND product_option_id = $2
      ORDER BY effective_from ASC, id ASC
      FOR UPDATE
    `,
    [clientId, productOptionId],
  );
  return rows.map(mapPrice);
}

export async function insertPrice(client, input) {
  const { rows } = await client.query(
    `
      INSERT INTO client_product_prices (
        client_id, product_option_id, sale_price, shipping_fee_override, effective_from, effective_to
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, client_id, product_option_id, sale_price, shipping_fee_override, effective_from, effective_to, created_at, updated_at
    `,
    [
      input.clientId,
      input.productOptionId,
      input.salePrice,
      input.shippingFeeOverride,
      input.effectiveFrom,
      input.effectiveTo,
    ],
  );
  return mapPrice(rows[0]);
}

export async function updatePriceRow(client, id, { salePrice, shippingFeeOverride }) {
  const { rows } = await client.query(
    `
      UPDATE client_product_prices
      SET sale_price = $2, shipping_fee_override = $3, updated_at = NOW()
      WHERE id = $1
      RETURNING id, client_id, product_option_id, sale_price, shipping_fee_override, effective_from, effective_to, created_at, updated_at
    `,
    [id, salePrice, shippingFeeOverride],
  );
  return rows[0] ? mapPrice(rows[0]) : null;
}

export async function closePricePeriod(client, id, effectiveTo) {
  const { rows } = await client.query(
    `
      UPDATE client_product_prices
      SET effective_to = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, client_id, product_option_id, sale_price, shipping_fee_override, effective_from, effective_to, created_at, updated_at
    `,
    [id, effectiveTo],
  );
  return rows[0] ? mapPrice(rows[0]) : null;
}

export async function findEffectivePriceRow(clientId, productOptionId, onDate, db = pool) {
  const { rows } = await db.query(
    `
      SELECT id, client_id, product_option_id, sale_price, shipping_fee_override, effective_from, effective_to, created_at, updated_at
      FROM client_product_prices
      WHERE client_id = $1
        AND product_option_id = $2
        AND effective_from <= $3::date
        AND (effective_to IS NULL OR effective_to >= $3::date)
      ORDER BY effective_from DESC, id DESC
      LIMIT 1
    `,
    [clientId, productOptionId, onDate],
  );
  return rows[0] ? mapPrice(rows[0]) : null;
}

export async function listEffectivePrices(clientId, onDate) {
  const { rows } = await pool.query(
    `
      SELECT ${PRICE_JOIN}
      FROM client_product_prices cpp
      INNER JOIN product_options o ON o.id = cpp.product_option_id
      INNER JOIN products p ON p.id = o.product_id
      WHERE cpp.client_id = $1
        AND cpp.effective_from <= $2::date
        AND (cpp.effective_to IS NULL OR cpp.effective_to >= $2::date)
      ORDER BY p.product_name ASC, o.option_name ASC NULLS FIRST, o.id ASC
    `,
    [clientId, onDate],
  );
  return rows.map(mapPrice);
}

export async function listClientProducts(clientId, { onDate, includeInactive }) {
  const { rows } = await pool.query(
    `
      SELECT
        o.id AS product_option_id,
        o.product_id,
        o.product_code,
        p.product_name,
        o.option_name,
        s.supplier_name,
        o.purchase_price,
        o.default_shipping_fee,
        (p.is_active AND o.is_active) AS is_active,
        cpp.sale_price AS current_sale_price,
        cpp.shipping_fee_override AS current_shipping_fee_override,
        cpp.effective_from,
        cpp.effective_to
      FROM product_options o
      INNER JOIN products p ON p.id = o.product_id
      INNER JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN LATERAL (
        SELECT sale_price, shipping_fee_override, effective_from, effective_to
        FROM client_product_prices
        WHERE client_id = $1
          AND product_option_id = o.id
          AND effective_from <= $2::date
          AND (effective_to IS NULL OR effective_to >= $2::date)
        ORDER BY effective_from DESC, id DESC
        LIMIT 1
      ) cpp ON TRUE
      WHERE ($3::boolean = TRUE OR (p.is_active = TRUE AND o.is_active = TRUE))
      ORDER BY p.product_name ASC, o.option_name ASC NULLS FIRST, o.id ASC
    `,
    [clientId, onDate, includeInactive],
  );

  return rows.map((row) => ({
    product_option_id: toPublicId(row.product_option_id),
    product_id: toPublicId(row.product_id),
    product_code: row.product_code ?? null,
    product_name: row.product_name,
    option_name: row.option_name,
    supplier_name: row.supplier_name,
    purchase_price: row.purchase_price,
    current_sale_price: row.current_sale_price,
    current_shipping_fee_override: row.current_shipping_fee_override,
    effective_from: toIsoDate(row.effective_from),
    effective_to: toIsoDate(row.effective_to),
    default_shipping_fee: row.default_shipping_fee,
    is_active: row.is_active,
  }));
}

export async function optionExists(productOptionId, db = pool) {
  const { rows } = await db.query("SELECT 1 FROM product_options WHERE id = $1", [productOptionId]);
  return rows.length > 0;
}

export async function getPriceById(id, db = pool) {
  const { rows } = await db.query(
    `
      SELECT ${PRICE_JOIN}
      FROM client_product_prices cpp
      INNER JOIN product_options o ON o.id = cpp.product_option_id
      INNER JOIN products p ON p.id = o.product_id
      WHERE cpp.id = $1
    `,
    [id],
  );
  return rows[0] ? mapPrice(rows[0]) : null;
}

export async function deletePrice(id, db = pool) {
  const { rowCount } = await db.query(`DELETE FROM client_product_prices WHERE id = $1`, [id]);
  return rowCount > 0;
}

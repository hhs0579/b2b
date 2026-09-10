import { pool } from "../../db/pool.js";
import { rethrowDatabaseError } from "../../utils/db-errors.js";
import { toPublicId } from "../../utils/validation.js";

export function mapOption(row) {
  return {
    id: toPublicId(row.id),
    product_id: toPublicId(row.product_id),
    option_name: row.option_name ?? null,
    product_code: row.product_code ?? null,
    barcode: row.barcode ?? null,
    purchase_price: row.purchase_price,
    vat_type: row.vat_type,
    carton_qty: row.carton_qty,
    default_shipping_fee: row.default_shipping_fee,
    default_shipping_type: row.default_shipping_type,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapProduct(row, options = []) {
  return {
    id: toPublicId(row.id),
    product_name: row.product_name,
    supplier_id: toPublicId(row.supplier_id),
    supplier_code: row.supplier_code ?? undefined,
    supplier_name: row.supplier_name ?? undefined,
    memo: row.memo,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    options,
  };
}

function mapHistory(row) {
  return {
    id: toPublicId(row.id),
    product_option_id: toPublicId(row.product_option_id),
    option_name: row.option_name ?? null,
    old_price: row.old_price,
    new_price: row.new_price,
    reason: row.reason,
    changed_at: row.changed_at,
  };
}

const PRODUCT_SELECT = `
  p.id, p.product_name, p.supplier_id, s.supplier_code, s.supplier_name,
  p.memo, p.is_active, p.created_at, p.updated_at
`;

const OPTION_SELECT = `
  o.id, o.product_id, o.option_name, o.product_code, o.barcode,
  o.purchase_price, o.vat_type, o.carton_qty, o.default_shipping_fee, o.default_shipping_type,
  o.is_active, o.created_at, o.updated_at
`;

export async function listOptionsByProductIds(productIds, client = pool) {
  if (productIds.length === 0) {
    return [];
  }
  const { rows } = await client.query(
    `
      SELECT ${OPTION_SELECT}
      FROM product_options o
      WHERE o.product_id = ANY($1::bigint[])
      ORDER BY o.option_name ASC NULLS FIRST, o.id ASC
    `,
    [productIds],
  );
  return rows.map(mapOption);
}

export async function attachOptions(products, client = pool) {
  const options = await listOptionsByProductIds(products.map((item) => item.id), client);
  const byProduct = new Map();
  for (const option of options) {
    const list = byProduct.get(option.product_id) || [];
    list.push(option);
    byProduct.set(option.product_id, list);
  }
  return products.map((item) => ({
    ...item,
    options: byProduct.get(item.id) || [],
  }));
}

export async function listProducts({ search, supplierId, isActive, limit, offset }) {
  const where = [];
  const params = [];

  if (search) {
    params.push(search);
    where.push(`(
      strpos(lower(p.product_name), lower($${params.length})) > 0
      OR EXISTS (
        SELECT 1 FROM product_options o
        WHERE o.product_id = p.id
          AND (
            strpos(lower(COALESCE(o.product_code, '')), lower($${params.length})) > 0
            OR strpos(lower(COALESCE(o.option_name, '')), lower($${params.length})) > 0
            OR strpos(lower(COALESCE(o.barcode, '')), lower($${params.length})) > 0
          )
      )
    )`);
  }

  if (supplierId !== undefined) {
    params.push(supplierId);
    where.push(`p.supplier_id = $${params.length}`);
  }

  if (isActive !== undefined) {
    params.push(isActive);
    where.push(`p.is_active = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM products p ${whereSql}`,
    params,
  );
  const listParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `
      SELECT ${PRODUCT_SELECT}
      FROM products p
      INNER JOIN suppliers s ON s.id = p.supplier_id
      ${whereSql}
      ORDER BY p.product_name ASC, p.id ASC
      LIMIT $${listParams.length - 1}
      OFFSET $${listParams.length}
    `,
    listParams,
  );

  return {
    items: await attachOptions(rows.map((row) => mapProduct(row))),
    total: countResult.rows[0].total,
  };
}

export async function getProductById(id, client = pool) {
  const { rows } = await client.query(
    `
      SELECT ${PRODUCT_SELECT}
      FROM products p
      INNER JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = $1
    `,
    [id],
  );
  if (!rows[0]) {
    return null;
  }
  const [product] = await attachOptions([mapProduct(rows[0])], client);
  return product;
}

export async function getOptionById(optionId, client = pool) {
  const { rows } = await client.query(
    `
      SELECT ${OPTION_SELECT}, p.product_name, p.is_active AS product_is_active
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
    ...mapOption(rows[0]),
    product_name: rows[0].product_name,
    product_is_active: rows[0].product_is_active,
    is_active: rows[0].is_active && rows[0].product_is_active,
  };
}

export async function supplierExists(supplierId, client = pool) {
  const { rows } = await client.query("SELECT 1 FROM suppliers WHERE id = $1", [supplierId]);
  return rows.length > 0;
}

export async function countOptions(productId, client = pool) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM product_options WHERE product_id = $1`,
    [productId],
  );
  return rows[0].n;
}

async function insertOption(client, productId, option) {
  const { rows } = await client.query(
    `
      INSERT INTO product_options (
        product_id, option_name, product_code, barcode, purchase_price, vat_type,
        carton_qty, default_shipping_fee, default_shipping_type, is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
    `,
    [
      productId,
      option.option_name,
      option.product_code,
      option.barcode,
      option.purchase_price,
      option.vat_type,
      option.carton_qty,
      option.default_shipping_fee,
      option.default_shipping_type,
      option.is_active,
    ],
  );
  return toPublicId(rows[0].id);
}

export async function createProduct(input) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
        INSERT INTO products (product_name, supplier_id, memo, is_active)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [input.product_name, input.supplier_id, input.memo, input.is_active],
    );
    const productId = toPublicId(rows[0].id);
    for (const option of input.options) {
      await insertOption(client, productId, option);
    }
    await client.query("COMMIT");
    return getProductById(productId);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already rolled back
    }
    rethrowDatabaseError(err);
  } finally {
    client.release();
  }
}

export async function updateProductBody(id, input) {
  await pool.query(
    `
      UPDATE products
      SET product_name = $2, supplier_id = $3, memo = $4, is_active = $5, updated_at = NOW()
      WHERE id = $1
    `,
    [id, input.product_name, input.supplier_id, input.memo, input.is_active],
  );
  return getProductById(id);
}

export async function createOption(productId, option) {
  try {
    await insertOption(pool, productId, option);
    return getProductById(productId);
  } catch (err) {
    rethrowDatabaseError(err);
  }
}

export async function updateOptionWithOptionalCostHistory(optionId, input, priceChanged, oldPrice) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
        UPDATE product_options
        SET
          option_name = $2,
          product_code = $3,
          barcode = $4,
          purchase_price = $5,
          vat_type = $6,
          carton_qty = $7,
          default_shipping_fee = $8,
          default_shipping_type = $9,
          is_active = $10,
          updated_at = NOW()
        WHERE id = $1
        RETURNING product_id
      `,
      [
        optionId,
        input.option_name,
        input.product_code,
        input.barcode,
        input.purchase_price,
        input.vat_type,
        input.carton_qty,
        input.default_shipping_fee,
        input.default_shipping_type,
        input.is_active,
      ],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    if (priceChanged) {
      await client.query(
        `
          INSERT INTO product_cost_history (product_option_id, old_price, new_price, reason)
          VALUES ($1, $2, $3, $4)
        `,
        [optionId, oldPrice, input.purchase_price, input.cost_change_reason],
      );
    }
    const productId = toPublicId(rows[0].product_id);
    await client.query("COMMIT");
    return getProductById(productId);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already rolled back
    }
    rethrowDatabaseError(err);
  } finally {
    client.release();
  }
}

export async function updateProductStatus(id, isActive) {
  const { rows } = await pool.query(
    `
      UPDATE products
      SET is_active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [id, isActive],
  );
  return rows[0] ? getProductById(id) : null;
}

export async function updateOptionStatus(optionId, isActive) {
  const { rows } = await pool.query(
    `
      UPDATE product_options
      SET is_active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING product_id
    `,
    [optionId, isActive],
  );
  return rows[0] ? getProductById(toPublicId(rows[0].product_id)) : null;
}

export async function deleteOption(optionId) {
  const { rows } = await pool.query(
    `DELETE FROM product_options WHERE id = $1 RETURNING product_id`,
    [optionId],
  );
  return rows[0] ? toPublicId(rows[0].product_id) : null;
}

export async function deleteProduct(id, db = pool) {
  await db.query(
    `
      DELETE FROM product_cost_history
      WHERE product_option_id IN (SELECT id FROM product_options WHERE product_id = $1)
    `,
    [id],
  );
  await db.query(`DELETE FROM product_options WHERE product_id = $1`, [id]);
  const { rowCount } = await db.query(`DELETE FROM products WHERE id = $1`, [id]);
  return rowCount > 0;
}

export async function listCostHistory(productId) {
  const { rows } = await pool.query(
    `
      SELECT h.id, h.product_option_id, o.option_name, h.old_price, h.new_price, h.reason, h.changed_at
      FROM product_cost_history h
      INNER JOIN product_options o ON o.id = h.product_option_id
      WHERE o.product_id = $1
      ORDER BY h.changed_at DESC, h.id DESC
    `,
    [productId],
  );
  return rows.map(mapHistory);
}

export async function listOptionCostHistory(optionId) {
  const { rows } = await pool.query(
    `
      SELECT h.id, h.product_option_id, o.option_name, h.old_price, h.new_price, h.reason, h.changed_at
      FROM product_cost_history h
      INNER JOIN product_options o ON o.id = h.product_option_id
      WHERE h.product_option_id = $1
      ORDER BY h.changed_at DESC, h.id DESC
    `,
    [optionId],
  );
  return rows.map(mapHistory);
}

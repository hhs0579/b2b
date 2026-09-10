import { pool } from "../../db/pool.js";

async function count(sql, params, db = pool) {
  const { rows } = await db.query(sql, params);
  return Number(rows[0]?.n || 0);
}

export async function supplierImpact(supplierId, db = pool) {
  const products = await count(`SELECT COUNT(*)::int AS n FROM products WHERE supplier_id = $1`, [supplierId], db);
  return {
    can_delete: products === 0,
    references: { products },
  };
}

export async function optionImpact(optionId, db = pool) {
  const [prices, aliases, imports, orderItems, confirmedOrders, shippingGroups] = await Promise.all([
    count(`SELECT COUNT(*)::int AS n FROM client_product_prices WHERE product_option_id = $1`, [optionId], db),
    count(`SELECT COUNT(*)::int AS n FROM product_aliases WHERE product_option_id = $1`, [optionId], db),
    count(`SELECT COUNT(*)::int AS n FROM order_import_rows WHERE matched_product_option_id = $1`, [optionId], db),
    count(`SELECT COUNT(*)::int AS n FROM order_items WHERE product_option_id = $1`, [optionId], db),
    count(
      `
        SELECT COUNT(DISTINCT oi.order_id)::int AS n
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_option_id = $1 AND o.status IN ('CONFIRMED', 'CANCELLED')
      `,
      [optionId],
      db,
    ),
    count(`SELECT COUNT(*)::int AS n FROM order_shipping_groups WHERE product_option_id = $1`, [optionId], db),
  ]);
  return {
    can_delete: prices === 0 && aliases === 0 && imports === 0 && orderItems === 0 && shippingGroups === 0,
    references: {
      prices,
      aliases,
      imports,
      order_items: orderItems,
      confirmed_orders: confirmedOrders,
      shipping_groups: shippingGroups,
    },
  };
}

export async function productImpact(productId, db = pool) {
  const optionFilter = `SELECT id FROM product_options WHERE product_id = $1`;
  const [prices, aliases, imports, orderItems, confirmedOrders, shippingGroups] = await Promise.all([
    count(`SELECT COUNT(*)::int AS n FROM client_product_prices WHERE product_option_id IN (${optionFilter})`, [productId], db),
    count(`SELECT COUNT(*)::int AS n FROM product_aliases WHERE product_option_id IN (${optionFilter})`, [productId], db),
    count(`SELECT COUNT(*)::int AS n FROM order_import_rows WHERE matched_product_option_id IN (${optionFilter})`, [productId], db),
    count(`SELECT COUNT(*)::int AS n FROM order_items WHERE product_id = $1 OR product_option_id IN (${optionFilter})`, [productId], db),
    count(
      `
        SELECT COUNT(DISTINCT oi.order_id)::int AS n
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE (oi.product_id = $1 OR oi.product_option_id IN (${optionFilter}))
          AND o.status IN ('CONFIRMED', 'CANCELLED')
      `,
      [productId],
      db,
    ),
    count(`SELECT COUNT(*)::int AS n FROM order_shipping_groups WHERE product_id = $1 OR product_option_id IN (${optionFilter})`, [productId], db),
  ]);
  return {
    can_delete: prices === 0 && aliases === 0 && imports === 0 && orderItems === 0 && shippingGroups === 0,
    references: {
      prices,
      aliases,
      imports,
      order_items: orderItems,
      confirmed_orders: confirmedOrders,
      shipping_groups: shippingGroups,
    },
  };
}

export async function salesClientImpact(clientId, db = pool) {
  const [prices, aliases, mappings, imports, orders, settlements] = await Promise.all([
    count(`SELECT COUNT(*)::int AS n FROM client_product_prices WHERE client_id = $1`, [clientId], db),
    count(`SELECT COUNT(*)::int AS n FROM product_aliases WHERE client_id = $1`, [clientId], db),
    count(`SELECT COUNT(*)::int AS n FROM excel_mappings WHERE client_id = $1`, [clientId], db),
    count(`SELECT COUNT(*)::int AS n FROM order_imports WHERE client_id = $1`, [clientId], db),
    count(`SELECT COUNT(*)::int AS n FROM orders WHERE client_id = $1`, [clientId], db),
    count(
      `
        SELECT COUNT(*)::int AS n
        FROM settlements s
        INNER JOIN orders o ON o.id = s.order_id
        WHERE o.client_id = $1
      `,
      [clientId],
      db,
    ),
  ]);
  return {
    can_delete:
      prices === 0 && aliases === 0 && mappings === 0 && imports === 0 && orders === 0 && settlements === 0,
    references: { prices, aliases, mappings, imports, orders, settlements },
  };
}

export async function priceImpact(priceId, db = pool) {
  const confirmedItems = await count(
    `
      SELECT COUNT(*)::int AS n
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE oi.price_source_id = $1 AND o.status IN ('CONFIRMED', 'CANCELLED')
    `,
    [priceId],
    db,
  );
  const allItems = await count(`SELECT COUNT(*)::int AS n FROM order_items WHERE price_source_id = $1`, [priceId], db);
  return {
    can_delete: allItems === 0,
    references: {
      order_items: allItems,
      confirmed_orders: confirmedItems,
    },
  };
}

export async function orderImportImpact(importId, db = pool) {
  const { rows } = await db.query(`SELECT id, status FROM orders WHERE order_import_id = $1`, [importId]);
  const order = rows[0] || null;
  const rowsCount = await count(`SELECT COUNT(*)::int AS n FROM order_import_rows WHERE order_import_id = $1`, [importId], db);
  const confirmed = order?.status === "CONFIRMED" || order?.status === "CANCELLED";
  return {
    can_delete: !order || order.status === "DRAFT",
    delete_draft_required: Boolean(order && order.status === "DRAFT"),
    references: {
      order_id: order ? Number(order.id) : null,
      order_status: order?.status || null,
      import_rows: rowsCount,
      confirmed_orders: confirmed ? 1 : 0,
    },
  };
}

export async function orderImpact(orderId, db = pool) {
  const { rows } = await db.query(`SELECT id, status, order_import_id FROM orders WHERE id = $1`, [orderId]);
  const order = rows[0] || null;
  return {
    can_delete: order?.status === "DRAFT",
    can_cancel: order?.status === "CONFIRMED",
    references: {
      status: order?.status || null,
      order_import_id: order ? Number(order.order_import_id) : null,
    },
  };
}

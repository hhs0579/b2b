import { pool } from "../../db/pool.js";
import { toIsoDate } from "../../domain/dates.js";
import { toPublicId } from "../../utils/validation.js";

function toMoney(value) {
  if (value == null) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return value;
  }
  return parsed;
}

function toRate(value) {
  if (value == null) {
    return 0;
  }
  return Number(value);
}

function mapOrder(row) {
  return {
    id: toPublicId(row.id),
    order_import_id: toPublicId(row.order_import_id),
    client_id: toPublicId(row.client_id),
    client_code: row.client_code ?? undefined,
    client_name: row.client_name ?? undefined,
    client_name_snapshot: row.client_name_snapshot ?? null,
    original_file_name: row.original_file_name ?? undefined,
    order_date: toIsoDate(row.order_date),
    status: row.status,
    shipping_type: row.shipping_type,
    shipping_calculation_mode: row.shipping_calculation_mode,
    manual_shipping_charge: row.manual_shipping_charge,
    shipping_config: row.shipping_config && typeof row.shipping_config === "object" ? row.shipping_config : {},
    total_quantity: row.total_quantity,
    total_product_sales: toMoney(row.total_product_sales),
    total_product_cost: toMoney(row.total_product_cost),
    total_product_margin: toMoney(row.total_product_margin),
    total_product_margin_rate: toRate(row.total_product_margin_rate),
    total_shipping_charge: toMoney(row.total_shipping_charge),
    total_invoice_amount: toMoney(row.total_invoice_amount),
    invoice_product_line_count: row.invoice_product_line_count,
    invoice_shipping_line_count: row.invoice_shipping_line_count,
    invoice_required_line_count: row.invoice_required_line_count,
    preview_signature: row.preview_signature,
    invoice_note: row.invoice_note ?? null,
    invoice_shipping_method: row.invoice_shipping_method ?? null,
    invoice_ship_date: toIsoDate(row.invoice_ship_date),
    invoice_destination: row.invoice_destination ?? null,
    invoice_manager: row.invoice_manager ?? null,
    invoice_supplier_profile_id: row.invoice_supplier_profile_id != null ? toPublicId(row.invoice_supplier_profile_id) : null,
    confirmed_at: row.confirmed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const ORDER_COLUMNS = `
  o.id, o.order_import_id, o.client_id, c.client_code,
  COALESCE(o.client_name_snapshot, c.client_name) AS client_name,
  o.client_name_snapshot,
  i.original_file_name, o.order_date, o.status, o.shipping_type, o.shipping_calculation_mode,
  o.manual_shipping_charge, o.shipping_config, o.total_quantity, o.total_product_sales, o.total_product_cost,
  o.total_product_margin, o.total_product_margin_rate, o.total_shipping_charge, o.total_invoice_amount,
  o.invoice_product_line_count, o.invoice_shipping_line_count, o.invoice_required_line_count,
  o.preview_signature, o.invoice_note,
  o.invoice_shipping_method, o.invoice_ship_date, o.invoice_destination, o.invoice_manager,
  o.invoice_supplier_profile_id,
  o.confirmed_at, o.created_at, o.updated_at
`;

export async function getOrderById(id, db = pool) {
  const { rows } = await db.query(
    `
      SELECT ${ORDER_COLUMNS}
      FROM orders o
      INNER JOIN sales_clients c ON c.id = o.client_id
      INNER JOIN order_imports i ON i.id = o.order_import_id
      WHERE o.id = $1
    `,
    [id],
  );
  return rows[0] ? mapOrder(rows[0]) : null;
}

export async function getOrderByImportId(importId, db = pool) {
  const { rows } = await db.query(
    `
      SELECT ${ORDER_COLUMNS}
      FROM orders o
      INNER JOIN sales_clients c ON c.id = o.client_id
      INNER JOIN order_imports i ON i.id = o.order_import_id
      WHERE o.order_import_id = $1
    `,
    [importId],
  );
  return rows[0] ? mapOrder(rows[0]) : null;
}

export async function insertDraft(input, db = pool) {
  const { rows } = await db.query(
    `
      INSERT INTO orders (
        order_import_id, client_id, order_date, status,
        shipping_type, shipping_calculation_mode, manual_shipping_charge
      )
      VALUES ($1,$2,$3,'DRAFT',$4,$5,$6)
      RETURNING id
    `,
    [
      input.order_import_id,
      input.client_id,
      input.order_date,
      input.shipping_type,
      input.shipping_calculation_mode,
      input.manual_shipping_charge,
    ],
  );
  return getOrderById(toPublicId(rows[0].id), db);
}

export async function updateSettings(id, patch, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE orders
      SET
        shipping_type = $2,
        shipping_calculation_mode = $3,
        manual_shipping_charge = $4,
        shipping_config = $5::jsonb,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [
      id,
      patch.shipping_type,
      patch.shipping_calculation_mode,
      patch.manual_shipping_charge,
      JSON.stringify(patch.shipping_config || {}),
    ],
  );
  return rows[0] ? getOrderById(id, db) : null;
}

export async function updateInvoiceSupplier(id, supplierProfileId, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE orders
      SET invoice_supplier_profile_id = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [id, supplierProfileId],
  );
  return rows[0] ? getOrderById(id, db) : null;
}

export async function updateInvoiceMemo(id, patch, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE orders
      SET
        invoice_shipping_method = $2,
        invoice_ship_date = $3,
        invoice_destination = $4,
        invoice_manager = $5,
        invoice_note = $6,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [
      id,
      patch.invoice_shipping_method,
      patch.invoice_ship_date,
      patch.invoice_destination,
      patch.invoice_manager,
      patch.invoice_note,
    ],
  );
  return rows[0] ? getOrderById(id, db) : null;
}

export async function lockOrder(id, db) {
  const { rows } = await db.query(`SELECT id, status FROM orders WHERE id = $1 FOR UPDATE`, [id]);
  return rows[0] || null;
}

export async function confirmOrder(id, totals, signature, clientNameSnapshot, db) {
  await db.query(
    `
      UPDATE orders
      SET
        status = 'CONFIRMED',
        client_name_snapshot = $13,
        total_quantity = $2,
        total_product_sales = $3,
        total_product_cost = $4,
        total_product_margin = $5,
        total_product_margin_rate = $6,
        total_shipping_charge = $7,
        total_invoice_amount = $8,
        invoice_product_line_count = $9,
        invoice_shipping_line_count = $10,
        invoice_required_line_count = $11,
        preview_signature = $12,
        confirmed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      id,
      totals.total_quantity,
      totals.total_product_sales,
      totals.total_product_cost,
      totals.total_product_margin,
      totals.total_product_margin_rate,
      totals.total_shipping_charge,
      totals.total_invoice_amount,
      totals.invoice_product_line_count,
      totals.invoice_shipping_line_count,
      totals.invoice_required_line_count,
      signature,
      clientNameSnapshot,
    ],
  );
  return getOrderById(id, db);
}

export async function insertOrderItems(orderId, items, db) {
  for (const item of items) {
    await db.query(
      `
        INSERT INTO order_items (
          order_id, source_import_row_id, product_id, product_option_id,
          product_code_snapshot, product_name_snapshot, option_name_snapshot,
          quantity, purchase_price_snapshot, sale_price_snapshot, price_source_id,
          carton_qty_snapshot, shipping_fee_per_carton_snapshot, shipping_fee_source,
          product_sales_amount, product_cost_amount, product_margin_amount, product_margin_rate,
          external_order_number, recipient_name, phone, address, shipping_memo
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      `,
      [
        orderId,
        item.source_import_row_id,
        item.product_id,
        item.product_option_id,
        item.product_code ?? null,
        item.product_name,
        item.option_name,
        item.quantity,
        item.purchase_price,
        item.sale_price,
        item.price_source_id,
        item.carton_qty,
        item.shipping_fee_per_carton,
        item.shipping_fee_source,
        item.product_sales_amount,
        item.product_cost_amount,
        item.product_margin_amount,
        item.product_margin_rate,
        item.external_order_number,
        item.recipient_name,
        item.phone,
        item.address,
        item.shipping_memo,
      ],
    );
  }
}

export async function insertShippingGroups(orderId, groups, db) {
  for (const group of groups) {
    await db.query(
      `
        INSERT INTO order_shipping_groups (
          order_id, shipping_calculation_mode, group_key, product_id, product_option_id,
          product_name_snapshot, option_name_snapshot, total_quantity,
          carton_qty_snapshot, carton_count, shipping_fee_per_carton_snapshot,
          shipping_fee_source, shipping_charge,
          shipping_type, shipping_type_source, truck_group_key, manual_shipping_charge, group_note
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      `,
      [
        orderId,
        group.shipping_calculation_mode,
        group.group_key,
        group.product_id,
        group.product_option_id,
        group.product_name,
        group.option_name,
        group.total_quantity,
        group.carton_qty,
        group.carton_count,
        group.shipping_fee_per_carton,
        group.shipping_fee_source,
        group.shipping_charge,
        group.shipping_type || null,
        group.shipping_type_source || null,
        group.truck_group_key || null,
        group.manual_shipping_charge ?? null,
        group.group_note || null,
      ],
    );
  }
}

export async function listOrderItems(orderId, db = pool) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM order_items
      WHERE order_id = $1
      ORDER BY id ASC
    `,
    [orderId],
  );
  return rows.map((row) => ({
    id: toPublicId(row.id),
    order_id: toPublicId(row.order_id),
    source_import_row_id: toPublicId(row.source_import_row_id),
    product_id: toPublicId(row.product_id),
    product_option_id: toPublicId(row.product_option_id),
    product_code: row.product_code_snapshot,
    product_name: row.product_name_snapshot,
    option_name: row.option_name_snapshot,
    quantity: row.quantity,
    purchase_price: row.purchase_price_snapshot,
    sale_price: row.sale_price_snapshot,
    price_source_id: row.price_source_id == null ? null : toPublicId(row.price_source_id),
    carton_qty: row.carton_qty_snapshot,
    shipping_fee_per_carton: row.shipping_fee_per_carton_snapshot,
    shipping_fee_source: row.shipping_fee_source,
    product_sales_amount: toMoney(row.product_sales_amount),
    product_cost_amount: toMoney(row.product_cost_amount),
    product_margin_amount: toMoney(row.product_margin_amount),
    product_margin_rate: toRate(row.product_margin_rate),
    external_order_number: row.external_order_number,
    recipient_name: row.recipient_name,
    phone: row.phone,
    address: row.address,
    shipping_memo: row.shipping_memo,
    created_at: row.created_at,
  }));
}

export async function listShippingGroups(orderId, db = pool) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM order_shipping_groups
      WHERE order_id = $1
      ORDER BY id ASC
    `,
    [orderId],
  );
  return rows.map((row) => ({
    id: toPublicId(row.id),
    order_id: toPublicId(row.order_id),
    shipping_calculation_mode: row.shipping_calculation_mode,
    group_key: row.group_key,
    product_id: toPublicId(row.product_id),
    product_option_id: toPublicId(row.product_option_id),
    product_name: row.product_name_snapshot,
    option_name: row.option_name_snapshot,
    total_quantity: row.total_quantity,
    carton_qty: row.carton_qty_snapshot,
    carton_count: row.carton_count,
    shipping_fee_per_carton: row.shipping_fee_per_carton_snapshot,
    shipping_fee_source: row.shipping_fee_source,
    shipping_charge: toMoney(row.shipping_charge),
    shipping_type: row.shipping_type || null,
    shipping_type_source: row.shipping_type_source || null,
    truck_group_key: row.truck_group_key || null,
    manual_shipping_charge: row.manual_shipping_charge == null ? null : toMoney(row.manual_shipping_charge),
    group_note: row.group_note || null,
  }));
}

export async function countOrderItems(orderId, db = pool) {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM order_items WHERE order_id = $1`, [orderId]);
  return rows[0].n;
}

export async function listOptionsByIds(ids, db = pool) {
  if (ids.length === 0) {
    return [];
  }
  const { rows } = await db.query(
    `
      SELECT
        o.id, o.product_id, o.product_code, p.product_name, o.option_name,
        o.purchase_price, o.carton_qty, o.default_shipping_fee,
        (p.is_active AND o.is_active) AS is_active
      FROM product_options o
      INNER JOIN products p ON p.id = o.product_id
      WHERE o.id = ANY($1::bigint[])
    `,
    [ids],
  );
  return rows.map((row) => ({
    id: toPublicId(row.id),
    product_id: toPublicId(row.product_id),
    product_code: row.product_code,
    product_name: row.product_name,
    option_name: row.option_name,
    purchase_price: row.purchase_price,
    carton_qty: row.carton_qty,
    default_shipping_fee: row.default_shipping_fee,
    is_active: row.is_active,
  }));
}

function mapLedgerRow(row) {
  return {
    ...mapOrder(row),
    invoice_version_count: Number(row.invoice_version_count || 0),
    product_kind_count: Number(row.product_kind_count ?? row.invoice_product_line_count ?? 0),
    settlement_id: row.settlement_id == null ? null : toPublicId(row.settlement_id),
    billing_amount: toMoney(row.billing_amount ?? row.total_invoice_amount),
    paid_amount: toMoney(row.paid_amount ?? 0),
    outstanding_amount: toMoney(row.outstanding_amount ?? row.total_invoice_amount),
    settlement_status: row.settlement_status ?? null,
    expected_payment_date: toIsoDate(row.expected_payment_date),
    last_payment_date: toIsoDate(row.last_payment_date),
    tax_invoice_status: row.tax_invoice_status ?? null,
    tax_invoice_issued_at: row.tax_invoice_issued_at ?? null,
    settlement_memo: row.settlement_memo ?? null,
  };
}

export async function listConfirmedOrders(filters, db = pool) {
  const params = [];
  const where = ["o.status = 'CONFIRMED'"];
  if (filters.from) {
    params.push(filters.from);
    where.push(`o.order_date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`o.order_date <= $${params.length}`);
  }
  if (filters.clientId) {
    params.push(filters.clientId);
    where.push(`o.client_id = $${params.length}`);
  }
  if (filters.productId) {
    params.push(filters.productId);
    where.push(`EXISTS (
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = o.id AND (oi.product_id = $${params.length} OR oi.product_option_id = $${params.length})
    )`);
  }
  if (filters.orderNumber) {
    params.push(filters.orderNumber);
    params.push(`%${filters.orderNumber}%`);
    where.push(`(
      o.id::text = $${params.length - 1}
      OR i.original_file_name ILIKE $${params.length}
      OR EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id = o.id AND oi.external_order_number ILIKE $${params.length}
      )
    )`);
  }
  if (filters.settlementStatuses?.length) {
    params.push(filters.settlementStatuses);
    where.push(`s.settlement_status = ANY($${params.length}::text[])`);
  }

  const orderBy =
    filters.sort === "expected_asc"
      ? "s.expected_payment_date ASC NULLS LAST, o.order_date ASC, o.id ASC"
      : "o.order_date DESC, o.id DESC";

  params.push(filters.limit);
  params.push(filters.offset);
  const { rows } = await db.query(
    `
      SELECT ${ORDER_COLUMNS},
        s.id AS settlement_id, s.billing_amount, s.paid_amount, s.outstanding_amount,
        s.settlement_status, s.expected_payment_date, s.last_payment_date,
        s.tax_invoice_status, s.tax_invoice_issued_at, s.memo AS settlement_memo,
        (
          SELECT COUNT(*)::int FROM generated_documents g
          WHERE g.order_id = o.id AND g.document_type = 'INVOICE' AND g.status = 'GENERATED'
        ) AS invoice_version_count,
        (
          SELECT COUNT(DISTINCT oi.product_id)::int FROM order_items oi WHERE oi.order_id = o.id
        ) AS product_kind_count
      FROM orders o
      INNER JOIN sales_clients c ON c.id = o.client_id
      INNER JOIN order_imports i ON i.id = o.order_import_id
      LEFT JOIN settlements s ON s.order_id = o.id
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );

  const countParams = params.slice(0, params.length - 2);
  const { rows: countRows } = await db.query(
    `
      SELECT COUNT(*)::int AS n
      FROM orders o
      INNER JOIN sales_clients c ON c.id = o.client_id
      INNER JOIN order_imports i ON i.id = o.order_import_id
      LEFT JOIN settlements s ON s.order_id = o.id
      WHERE ${where.join(" AND ")}
    `,
    countParams,
  );
  return { items: rows.map(mapLedgerRow), total: countRows[0].n };
}

export async function deleteDraftOrder(id, db = pool) {
  await db.query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
  await db.query(`DELETE FROM order_shipping_groups WHERE order_id = $1`, [id]);
  const { rowCount } = await db.query(`DELETE FROM orders WHERE id = $1 AND status = 'DRAFT'`, [id]);
  return rowCount > 0;
}

export async function cancelConfirmedOrder(id, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE orders
      SET status = 'CANCELLED', updated_at = NOW()
      WHERE id = $1 AND status = 'CONFIRMED'
      RETURNING id
    `,
    [id],
  );
  return rows[0] ? getOrderById(id, db) : null;
}

export async function getConfirmedLedger(id, db = pool) {
  const { rows } = await db.query(
    `
      SELECT ${ORDER_COLUMNS},
        s.id AS settlement_id, s.billing_amount, s.paid_amount, s.outstanding_amount,
        s.settlement_status, s.expected_payment_date, s.last_payment_date,
        s.tax_invoice_status, s.tax_invoice_issued_at, s.memo AS settlement_memo,
        (
          SELECT COUNT(*)::int FROM generated_documents g
          WHERE g.order_id = o.id AND g.document_type = 'INVOICE' AND g.status = 'GENERATED'
        ) AS invoice_version_count,
        (
          SELECT COUNT(DISTINCT oi.product_id)::int FROM order_items oi WHERE oi.order_id = o.id
        ) AS product_kind_count
      FROM orders o
      INNER JOIN sales_clients c ON c.id = o.client_id
      INNER JOIN order_imports i ON i.id = o.order_import_id
      LEFT JOIN settlements s ON s.order_id = o.id
      WHERE o.id = $1
    `,
    [id],
  );
  return rows[0] ? mapLedgerRow(rows[0]) : null;
}

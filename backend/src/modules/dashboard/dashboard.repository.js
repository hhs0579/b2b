import { pool } from "../../db/pool.js";
import { toIsoDate } from "../../domain/dates.js";
import { toPublicId } from "../../utils/validation.js";

function toMoney(value) {
  if (value == null) {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

export async function kpiSnapshot({ today, monthStart }) {
  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(SUM(o.total_invoice_amount) FILTER (WHERE o.order_date = $1), 0)::bigint AS today_sales,
        COALESCE(SUM(o.total_invoice_amount) FILTER (WHERE o.order_date >= $2 AND o.order_date <= $1), 0)::bigint AS month_sales,
        COALESCE(SUM(o.total_product_margin) FILTER (WHERE o.order_date >= $2 AND o.order_date <= $1), 0)::bigint AS month_product_margin,
        COALESCE(SUM(s.outstanding_amount) FILTER (WHERE s.settlement_status IN ('UNPAID', 'PARTIAL')), 0)::bigint AS outstanding_total,
        COUNT(*) FILTER (WHERE s.settlement_status IN ('UNPAID', 'PARTIAL'))::int AS unsettled_count
      FROM orders o
      LEFT JOIN settlements s ON s.order_id = o.id
      WHERE o.status = 'CONFIRMED'
    `,
    [today, monthStart],
  );
  const row = rows[0];
  return {
    today_sales: toMoney(row.today_sales),
    month_sales: toMoney(row.month_sales),
    month_product_margin: toMoney(row.month_product_margin),
    outstanding_total: toMoney(row.outstanding_total),
    unsettled_count: row.unsettled_count,
  };
}

export async function recentConfirmed(limit = 10) {
  const { rows } = await pool.query(
    `
      SELECT o.id, o.order_date, COALESCE(o.client_name_snapshot, c.client_name) AS client_name,
             o.total_invoice_amount, o.total_product_margin, s.settlement_status
      FROM orders o
      INNER JOIN sales_clients c ON c.id = o.client_id
      LEFT JOIN settlements s ON s.order_id = o.id
      WHERE o.status = 'CONFIRMED'
      ORDER BY o.order_date DESC, o.id DESC
      LIMIT $1
    `,
    [limit],
  );
  return rows.map((row) => ({
    id: toPublicId(row.id),
    order_date: toIsoDate(row.order_date),
    client_name: row.client_name,
    total_invoice_amount: toMoney(row.total_invoice_amount),
    total_product_margin: toMoney(row.total_product_margin),
    settlement_status: row.settlement_status,
  }));
}

export async function topOutstanding(limit = 10) {
  const { rows } = await pool.query(
    `
      SELECT o.id, o.order_date, COALESCE(o.client_name_snapshot, c.client_name) AS client_name,
             s.billing_amount, s.paid_amount, s.outstanding_amount, s.expected_payment_date, s.settlement_status
      FROM settlements s
      INNER JOIN orders o ON o.id = s.order_id
      INNER JOIN sales_clients c ON c.id = o.client_id
      WHERE o.status = 'CONFIRMED' AND s.settlement_status IN ('UNPAID', 'PARTIAL')
      ORDER BY s.outstanding_amount DESC, o.order_date ASC
      LIMIT $1
    `,
    [limit],
  );
  return rows.map((row) => ({
    id: toPublicId(row.id),
    order_date: toIsoDate(row.order_date),
    client_name: row.client_name,
    billing_amount: toMoney(row.billing_amount),
    paid_amount: toMoney(row.paid_amount),
    outstanding_amount: toMoney(row.outstanding_amount),
    expected_payment_date: toIsoDate(row.expected_payment_date),
    settlement_status: row.settlement_status,
  }));
}

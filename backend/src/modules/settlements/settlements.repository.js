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

export function mapSettlement(row) {
  return {
    id: toPublicId(row.id),
    order_id: toPublicId(row.order_id),
    billing_amount: toMoney(row.billing_amount),
    paid_amount: toMoney(row.paid_amount),
    outstanding_amount: toMoney(row.outstanding_amount),
    settlement_status: row.settlement_status,
    expected_payment_date: toIsoDate(row.expected_payment_date),
    last_payment_date: toIsoDate(row.last_payment_date),
    tax_invoice_status: row.tax_invoice_status,
    tax_invoice_issued_at: row.tax_invoice_issued_at,
    memo: row.memo ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapPayment(row) {
  return {
    id: toPublicId(row.id),
    settlement_id: toPublicId(row.settlement_id),
    amount: toMoney(row.amount),
    paid_at: toIsoDate(row.paid_at),
    memo: row.memo ?? null,
    created_at: row.created_at,
  };
}

export async function insertInitialSettlement(orderId, billingAmount, db = pool) {
  const { rows } = await db.query(
    `
      INSERT INTO settlements (
        order_id, billing_amount, paid_amount, outstanding_amount, settlement_status
      )
      VALUES ($1, $2, 0, $2, 'UNPAID')
      RETURNING *
    `,
    [orderId, billingAmount],
  );
  return mapSettlement(rows[0]);
}

export async function getByOrderId(orderId, db = pool) {
  const { rows } = await db.query(`SELECT * FROM settlements WHERE order_id = $1`, [orderId]);
  return rows[0] ? mapSettlement(rows[0]) : null;
}

export async function getById(id, db = pool) {
  const { rows } = await db.query(`SELECT * FROM settlements WHERE id = $1`, [id]);
  return rows[0] ? mapSettlement(rows[0]) : null;
}

export async function lockByOrderId(orderId, db) {
  const { rows } = await db.query(`SELECT * FROM settlements WHERE order_id = $1 FOR UPDATE`, [orderId]);
  return rows[0] ? mapSettlement(rows[0]) : null;
}

export async function updateComputed(id, computed, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE settlements
      SET
        paid_amount = $2,
        outstanding_amount = $3,
        settlement_status = $4,
        last_payment_date = $5,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, computed.paid_amount, computed.outstanding_amount, computed.settlement_status, computed.last_payment_date],
  );
  return mapSettlement(rows[0]);
}

export async function updateMeta(id, patch, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE settlements
      SET
        expected_payment_date = $2,
        tax_invoice_status = $3,
        tax_invoice_issued_at = $4,
        memo = $5,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, patch.expected_payment_date, patch.tax_invoice_status, patch.tax_invoice_issued_at, patch.memo],
  );
  return mapSettlement(rows[0]);
}

export async function listPayments(settlementId, db = pool) {
  const { rows } = await db.query(
    `
      SELECT * FROM payment_transactions
      WHERE settlement_id = $1
      ORDER BY paid_at ASC, id ASC
    `,
    [settlementId],
  );
  return rows.map(mapPayment);
}

export async function getPaymentById(id, db = pool) {
  const { rows } = await db.query(`SELECT * FROM payment_transactions WHERE id = $1`, [id]);
  return rows[0] ? mapPayment(rows[0]) : null;
}

export async function insertPayment(input, db = pool) {
  const { rows } = await db.query(
    `
      INSERT INTO payment_transactions (settlement_id, amount, paid_at, memo)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [input.settlement_id, input.amount, input.paid_at, input.memo],
  );
  return mapPayment(rows[0]);
}

export async function updatePayment(id, input, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE payment_transactions
      SET amount = $2, paid_at = $3, memo = $4
      WHERE id = $1
      RETURNING *
    `,
    [id, input.amount, input.paid_at, input.memo],
  );
  return rows[0] ? mapPayment(rows[0]) : null;
}

export async function deletePayment(id, db = pool) {
  await db.query(`DELETE FROM payment_transactions WHERE id = $1`, [id]);
}

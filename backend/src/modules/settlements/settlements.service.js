import { pool } from "../../db/pool.js";
import { AppError } from "../../utils/app-error.js";
import { optionalDate, optionalText, parseId, requiredDate, requiredInt } from "../../utils/validation.js";
import { recalcSettlement } from "../../domain/settlement.js";
import * as settlementsRepository from "./settlements.repository.js";
import { insertAuditLog } from "../audit/audit.repository.js";

async function applyRecalc(settlement, db) {
  const payments = await settlementsRepository.listPayments(settlement.id, db);
  const computed = recalcSettlement(settlement.billing_amount, payments);
  return settlementsRepository.updateComputed(settlement.id, computed, db);
}

export async function updateSettlement(orderIdParam, body) {
  const orderId = parseId(orderIdParam);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const locked = await settlementsRepository.lockByOrderId(orderId, db);
    if (!locked) {
      throw new AppError("SETTLEMENT_NOT_FOUND", "정산 정보를 찾을 수 없습니다.", 404);
    }
    const expected = body.expected_payment_date === undefined
      ? locked.expected_payment_date
      : optionalDate(body.expected_payment_date);
    const memo = body.memo === undefined ? locked.memo : optionalText(body.memo);
    let taxStatus = locked.tax_invoice_status;
    let issuedAt = locked.tax_invoice_issued_at;
    if (body.tax_invoice_status != null) {
      if (!["NOT_ISSUED", "ISSUED"].includes(body.tax_invoice_status)) {
        throw new AppError("INVALID_TAX_INVOICE_STATUS", "세금계산서 상태가 올바르지 않습니다.", 400);
      }
      taxStatus = body.tax_invoice_status;
      if (taxStatus === "ISSUED") {
        issuedAt = body.tax_invoice_issued_at
          ? optionalDate(body.tax_invoice_issued_at, "INVALID_TAX_INVOICE_ISSUED_AT", "세금계산서 발행일이 올바르지 않습니다.")
          : locked.tax_invoice_issued_at || new Date().toISOString();
      } else {
        issuedAt = null;
      }
    }
    const updated = await settlementsRepository.updateMeta(
      locked.id,
      {
        expected_payment_date: expected,
        tax_invoice_status: taxStatus,
        tax_invoice_issued_at: issuedAt,
        memo,
      },
      db,
    );
    await db.query("COMMIT");
    return updated;
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

export async function addPayment(orderIdParam, body) {
  const orderId = parseId(orderIdParam);
  const amount = requiredInt(body.amount, {
    min: 1,
    code: "INVALID_PAYMENT_AMOUNT",
    message: "입금액은 1 이상의 정수여야 합니다.",
  });
  const paidAt = requiredDate(body.paid_at, "INVALID_PAID_AT", "입금일은 YYYY-MM-DD 여야 합니다.");
  const memo = optionalText(body.memo);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const settlement = await settlementsRepository.lockByOrderId(orderId, db);
    if (!settlement) {
      throw new AppError("SETTLEMENT_NOT_FOUND", "정산 정보를 찾을 수 없습니다.", 404);
    }
    const payment = await settlementsRepository.insertPayment(
      { settlement_id: settlement.id, amount, paid_at: paidAt, memo },
      db,
    );
    const updated = await applyRecalc(settlement, db);
    await db.query("COMMIT");
    return { settlement: updated, payment };
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

export async function updatePayment(orderIdParam, paymentIdParam, body) {
  const orderId = parseId(orderIdParam);
  const paymentId = parseId(paymentIdParam);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const settlement = await settlementsRepository.lockByOrderId(orderId, db);
    if (!settlement) {
      throw new AppError("SETTLEMENT_NOT_FOUND", "정산 정보를 찾을 수 없습니다.", 404);
    }
    const existing = await settlementsRepository.getPaymentById(paymentId, db);
    if (!existing || existing.settlement_id !== settlement.id) {
      throw new AppError("PAYMENT_NOT_FOUND", "입금기록을 찾을 수 없습니다.", 404);
    }
    const amount = body.amount === undefined
      ? existing.amount
      : requiredInt(body.amount, { min: 1, code: "INVALID_PAYMENT_AMOUNT", message: "입금액은 1 이상의 정수여야 합니다." });
    const paidAt = body.paid_at === undefined
      ? existing.paid_at
      : requiredDate(body.paid_at, "INVALID_PAID_AT", "입금일은 YYYY-MM-DD 여야 합니다.");
    const memo = body.memo === undefined ? existing.memo : optionalText(body.memo);
    const payment = await settlementsRepository.updatePayment(paymentId, { amount, paid_at: paidAt, memo }, db);
    const updated = await applyRecalc(settlement, db);
    await db.query("COMMIT");
    return { settlement: updated, payment };
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

export async function removePayment(orderIdParam, paymentIdParam) {
  const orderId = parseId(orderIdParam);
  const paymentId = parseId(paymentIdParam);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const settlement = await settlementsRepository.lockByOrderId(orderId, db);
    if (!settlement) {
      throw new AppError("SETTLEMENT_NOT_FOUND", "정산 정보를 찾을 수 없습니다.", 404);
    }
    const existing = await settlementsRepository.getPaymentById(paymentId, db);
    if (!existing || existing.settlement_id !== settlement.id) {
      throw new AppError("PAYMENT_NOT_FOUND", "입금기록을 찾을 수 없습니다.", 404);
    }
    await settlementsRepository.deletePayment(paymentId, db);
    const updated = await applyRecalc(settlement, db);
    await insertAuditLog({
      entity_type: "payment_transaction",
      entity_id: paymentId,
      action: "DELETE",
      before_data: existing,
    }, db);
    await db.query("COMMIT");
    return { settlement: updated };
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

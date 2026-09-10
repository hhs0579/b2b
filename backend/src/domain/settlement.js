import { AppError } from "../utils/app-error.js";

export function settlementStatusFromAmounts(billingAmount, paidAmount) {
  if (paidAmount <= 0) {
    return "UNPAID";
  }
  if (paidAmount >= billingAmount) {
    return "PAID";
  }
  return "PARTIAL";
}

export function recalcSettlement(billingAmount, payments) {
  const paid_amount = payments.reduce((sum, item) => sum + item.amount, 0);
  if (paid_amount > billingAmount) {
    throw new AppError("OVERPAYMENT", "입금액이 청구액을 초과할 수 없습니다.", 400, {
      billing_amount: billingAmount,
      paid_amount,
    });
  }
  const dates = payments.map((item) => item.paid_at).filter(Boolean).sort();
  return {
    paid_amount,
    outstanding_amount: billingAmount - paid_amount,
    settlement_status: settlementStatusFromAmounts(billingAmount, paid_amount),
    last_payment_date: dates.length ? dates[dates.length - 1] : null,
  };
}

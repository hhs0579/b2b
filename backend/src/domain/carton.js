import { AppError } from "../utils/app-error.js";

/**
 * 카톤수는 이 함수에서만 계산한다.
 * ceil(quantity / cartonQty)와 동일하되, float 나눗셈을 쓰지 않는다.
 */
export function cartonCount(quantity, cartonQty) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new AppError("INVALID_CARTON_QUANTITY", "카톤 계산 수량은 1 이상의 정수여야 합니다.", 400);
  }
  if (!Number.isInteger(cartonQty) || cartonQty < 1) {
    throw new AppError("INVALID_CARTON_QTY", "카톤입수량은 1 이상의 정수여야 합니다.", 400);
  }
  const quotient = Math.floor(quantity / cartonQty);
  const remainder = quantity % cartonQty;
  return remainder === 0 ? quotient : quotient + 1;
}

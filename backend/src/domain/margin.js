/**
 * 제안가 기준 예상 상품마진.
 * 실제 거래 마진(택배원가, 용차, 기타비용)이 아니다.
 * 발주 확정 시 Frontend 표시값을 쓰지 않고 Backend가 다시 계산/조회한다.
 */
export function estimateProductMargin(salePrice, purchasePrice) {
  if (!Number.isInteger(salePrice) || !Number.isInteger(purchasePrice)) {
    return {
      estimated_margin: null,
      estimated_margin_rate: null,
    };
  }

  const estimated_margin = salePrice - purchasePrice;
  const estimated_margin_rate =
    salePrice > 0 ? Math.round((estimated_margin * 10000) / salePrice) / 100 : 0;

  return {
    estimated_margin,
    estimated_margin_rate,
  };
}

export function todayKst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export function formatIsoDate(value) {
  if (!value) {
    return "현재";
  }
  return String(value).slice(0, 10);
}

/** 표시용. 발주 확정 가격/마진은 Backend 조회 결과를 사용한다. */
export function estimateProductMargin(salePrice, purchasePrice) {
  if (!Number.isInteger(salePrice) || !Number.isInteger(purchasePrice)) {
    return { estimated_margin: null, estimated_margin_rate: null };
  }
  const estimated_margin = salePrice - purchasePrice;
  const estimated_margin_rate =
    salePrice > 0 ? Math.round((estimated_margin * 10000) / salePrice) / 100 : 0;
  return { estimated_margin, estimated_margin_rate };
}

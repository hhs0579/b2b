export function marginAmount(salesAmount, costAmount) {
  return salesAmount - costAmount;
}

export function marginRate(salesAmount, margin) {
  if (!Number.isInteger(salesAmount) || salesAmount <= 0) {
    return 0;
  }
  return Math.round((margin * 10000) / salesAmount) / 100;
}

export function lineAmounts(quantity, salePrice, purchasePrice) {
  const product_sales_amount = quantity * salePrice;
  const product_cost_amount = quantity * purchasePrice;
  const product_margin_amount = marginAmount(product_sales_amount, product_cost_amount);
  return {
    product_sales_amount,
    product_cost_amount,
    product_margin_amount,
    product_margin_rate: marginRate(product_sales_amount, product_margin_amount),
  };
}

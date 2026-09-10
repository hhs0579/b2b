export function mapCreatedProduct(data) {
  const option = data?.options?.[0] || {};
  return {
    ...data,
    option_id: option.id,
    product_option_id: option.id,
    product_code: option.product_code ?? null,
    option_name: option.option_name ?? null,
    barcode: option.barcode ?? null,
    purchase_price: option.purchase_price,
    vat_type: option.vat_type,
    carton_qty: option.carton_qty,
    default_shipping_fee: option.default_shipping_fee,
    default_shipping_type: option.default_shipping_type,
    option_is_active: option.is_active,
  };
}

export async function deleteProductsByIds(pool, productIds) {
  if (!productIds?.length) {
    return;
  }
  await pool.query(
    `
      DELETE FROM product_cost_history
      WHERE product_option_id IN (SELECT id FROM product_options WHERE product_id = ANY($1::bigint[]))
    `,
    [productIds],
  );
  await pool.query(`DELETE FROM product_options WHERE product_id = ANY($1::bigint[])`, [productIds]);
  await pool.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [productIds]);
}

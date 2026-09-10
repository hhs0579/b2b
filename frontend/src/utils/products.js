export function flattenProductOptions(products = []) {
  return products.flatMap((product) =>
    (product.options || []).map((option) => ({
      ...option,
      product_option_id: option.id,
      product_id: option.product_id ?? product.id,
      product_name: product.product_name,
      supplier_id: product.supplier_id,
      supplier_code: product.supplier_code,
      supplier_name: product.supplier_name,
      product_memo: product.memo,
      product_is_active: product.is_active,
      is_active: Boolean(product.is_active && option.is_active),
    })),
  );
}

export function optionLabel(option) {
  const name = option.product_name || "";
  const opt = option.option_name ? ` ${option.option_name}` : "";
  return `${name}${opt}`.trim();
}

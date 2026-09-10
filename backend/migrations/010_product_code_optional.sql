-- products.product_code is optional. Unique only when a value exists.
-- Internal relations continue to use products.id.

ALTER TABLE products
  ALTER COLUMN product_code DROP NOT NULL;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_product_code_key;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_product_code_not_blank;

UPDATE products
SET product_code = NULL
WHERE product_code IS NOT NULL AND btrim(product_code) = '';

ALTER TABLE products
  ADD CONSTRAINT products_product_code_not_blank
  CHECK (
    product_code IS NULL
    OR (product_code = btrim(product_code) AND product_code <> '')
  );

CREATE UNIQUE INDEX IF NOT EXISTS products_product_code_unique
  ON products (product_code)
  WHERE product_code IS NOT NULL;

ALTER TABLE order_items
  ALTER COLUMN product_code_snapshot DROP NOT NULL;

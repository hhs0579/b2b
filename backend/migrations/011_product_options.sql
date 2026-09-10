-- Split product master into products (name/supplier) and product_options (code/cost/carton/shipping).
-- Existing products.id is copied onto product_options.id so current FKs keep their numeric values.

CREATE TABLE product_options (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products (id),
  option_name TEXT,
  product_code TEXT,
  barcode TEXT,
  purchase_price INTEGER NOT NULL,
  vat_type TEXT NOT NULL,
  carton_qty INTEGER NOT NULL,
  default_shipping_fee INTEGER NOT NULL DEFAULT 0,
  default_shipping_type TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_options_option_name_not_blank CHECK (
    option_name IS NULL OR (option_name = btrim(option_name) AND option_name <> '')
  ),
  CONSTRAINT product_options_product_code_not_blank CHECK (
    product_code IS NULL OR (product_code = btrim(product_code) AND product_code <> '')
  ),
  CONSTRAINT product_options_barcode_not_blank CHECK (
    barcode IS NULL OR (barcode = btrim(barcode) AND barcode <> '')
  ),
  CONSTRAINT product_options_purchase_price_check CHECK (purchase_price >= 0),
  CONSTRAINT product_options_carton_qty_check CHECK (carton_qty >= 1),
  CONSTRAINT product_options_shipping_fee_check CHECK (default_shipping_fee >= 0),
  CONSTRAINT product_options_vat_type_check CHECK (vat_type IN ('INCLUDED', 'EXCLUDED', 'ZERO')),
  CONSTRAINT product_options_shipping_type_check CHECK (
    default_shipping_type IN ('PARCEL', 'FREE', 'COLLECT', 'TRUCK', 'MANUAL')
  )
);

INSERT INTO product_options (
  id, product_id, option_name, product_code, barcode, purchase_price, vat_type,
  carton_qty, default_shipping_fee, default_shipping_type, is_active, created_at, updated_at
)
OVERRIDING SYSTEM VALUE
SELECT
  id, id, option_name, product_code, barcode, purchase_price, vat_type,
  carton_qty, default_shipping_fee, default_shipping_type, is_active, created_at, updated_at
FROM products;

SELECT setval(
  pg_get_serial_sequence('product_options', 'id'),
  (SELECT COALESCE(MAX(id), 1) FROM product_options),
  (SELECT EXISTS (SELECT 1 FROM product_options))
);

CREATE UNIQUE INDEX product_options_product_code_unique
  ON product_options (product_code)
  WHERE product_code IS NOT NULL;

CREATE UNIQUE INDEX product_options_barcode_unique
  ON product_options (barcode)
  WHERE barcode IS NOT NULL;

CREATE UNIQUE INDEX product_options_default_unique
  ON product_options (product_id)
  WHERE option_name IS NULL;

CREATE UNIQUE INDEX product_options_named_unique
  ON product_options (product_id, option_name)
  WHERE option_name IS NOT NULL;

CREATE INDEX product_options_product_id_idx ON product_options (product_id);
CREATE INDEX product_options_is_active_idx ON product_options (is_active);

-- client_product_prices: product_id -> product_option_id (same numeric ids)
ALTER TABLE client_product_prices
  DROP CONSTRAINT IF EXISTS client_product_prices_no_overlap;
ALTER TABLE client_product_prices
  DROP CONSTRAINT IF EXISTS client_product_prices_product_id_fkey;
ALTER TABLE client_product_prices
  RENAME COLUMN product_id TO product_option_id;
ALTER TABLE client_product_prices
  ADD CONSTRAINT client_product_prices_product_option_id_fkey
  FOREIGN KEY (product_option_id) REFERENCES product_options (id);
ALTER TABLE client_product_prices
  ADD CONSTRAINT client_product_prices_no_overlap EXCLUDE USING gist (
    client_id WITH =,
    product_option_id WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  );
DROP INDEX IF EXISTS client_product_prices_lookup_idx;
CREATE INDEX client_product_prices_lookup_idx
  ON client_product_prices (client_id, product_option_id, effective_from);

-- product_aliases
ALTER TABLE product_aliases
  DROP CONSTRAINT IF EXISTS product_aliases_product_id_fkey;
ALTER TABLE product_aliases
  RENAME COLUMN product_id TO product_option_id;
ALTER TABLE product_aliases
  ADD CONSTRAINT product_aliases_product_option_id_fkey
  FOREIGN KEY (product_option_id) REFERENCES product_options (id);
DROP INDEX IF EXISTS product_aliases_product_idx;
CREATE INDEX product_aliases_product_option_idx ON product_aliases (product_option_id);

-- order_import_rows
ALTER TABLE order_import_rows
  DROP CONSTRAINT IF EXISTS order_import_rows_product_id_fkey;
ALTER TABLE order_import_rows
  RENAME COLUMN matched_product_id TO matched_product_option_id;
ALTER TABLE order_import_rows
  ADD CONSTRAINT order_import_rows_product_option_id_fkey
  FOREIGN KEY (matched_product_option_id) REFERENCES product_options (id);

-- order_items: keep products.id as parent, add option FK
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS product_option_id BIGINT;
UPDATE order_items
SET product_option_id = product_id
WHERE product_option_id IS NULL;
ALTER TABLE order_items
  ALTER COLUMN product_option_id SET NOT NULL;
ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS order_items_product_option_id_fkey;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_product_option_id_fkey
  FOREIGN KEY (product_option_id) REFERENCES product_options (id);
CREATE INDEX IF NOT EXISTS order_items_product_option_id_idx ON order_items (product_option_id);

-- order_shipping_groups
ALTER TABLE order_shipping_groups
  ADD COLUMN IF NOT EXISTS product_option_id BIGINT;
UPDATE order_shipping_groups
SET product_option_id = product_id
WHERE product_option_id IS NULL;
ALTER TABLE order_shipping_groups
  ALTER COLUMN product_option_id SET NOT NULL;
ALTER TABLE order_shipping_groups
  DROP CONSTRAINT IF EXISTS order_shipping_groups_product_option_id_fkey;
ALTER TABLE order_shipping_groups
  ADD CONSTRAINT order_shipping_groups_product_option_id_fkey
  FOREIGN KEY (product_option_id) REFERENCES product_options (id);

-- cost history
ALTER TABLE product_cost_history
  DROP CONSTRAINT IF EXISTS product_cost_history_product_id_fkey;
ALTER TABLE product_cost_history
  RENAME COLUMN product_id TO product_option_id;
ALTER TABLE product_cost_history
  ADD CONSTRAINT product_cost_history_product_option_id_fkey
  FOREIGN KEY (product_option_id) REFERENCES product_options (id);
DROP INDEX IF EXISTS product_cost_history_product_changed_idx;
CREATE INDEX product_cost_history_option_changed_idx
  ON product_cost_history (product_option_id, changed_at DESC);

-- products keeps name/supplier/memo/status only
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_code_not_blank;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_purchase_price_check;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_carton_qty_check;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_shipping_fee_check;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_vat_type_check;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_shipping_type_check;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_not_blank;
DROP INDEX IF EXISTS products_product_code_unique;
DROP INDEX IF EXISTS products_barcode_unique;

ALTER TABLE products DROP COLUMN IF EXISTS product_code;
ALTER TABLE products DROP COLUMN IF EXISTS option_name;
ALTER TABLE products DROP COLUMN IF EXISTS barcode;
ALTER TABLE products DROP COLUMN IF EXISTS purchase_price;
ALTER TABLE products DROP COLUMN IF EXISTS vat_type;
ALTER TABLE products DROP COLUMN IF EXISTS carton_qty;
ALTER TABLE products DROP COLUMN IF EXISTS default_shipping_fee;
ALTER TABLE products DROP COLUMN IF EXISTS default_shipping_type;

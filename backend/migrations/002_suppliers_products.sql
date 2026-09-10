CREATE TABLE suppliers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_code TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  business_number TEXT,
  manager_name TEXT,
  phone TEXT,
  email TEXT,
  memo TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT suppliers_supplier_code_key UNIQUE (supplier_code),
  CONSTRAINT suppliers_supplier_code_not_blank CHECK (supplier_code = btrim(supplier_code) AND supplier_code <> ''),
  CONSTRAINT suppliers_supplier_name_not_blank CHECK (supplier_name = btrim(supplier_name) AND supplier_name <> '')
);

CREATE TABLE products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  option_name TEXT,
  barcode TEXT,
  supplier_id BIGINT NOT NULL REFERENCES suppliers (id),
  purchase_price INTEGER NOT NULL,
  vat_type TEXT NOT NULL,
  carton_qty INTEGER NOT NULL,
  default_shipping_fee INTEGER NOT NULL DEFAULT 0,
  default_shipping_type TEXT NOT NULL,
  memo TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT products_product_code_key UNIQUE (product_code),
  CONSTRAINT products_product_code_not_blank CHECK (product_code = btrim(product_code) AND product_code <> ''),
  CONSTRAINT products_product_name_not_blank CHECK (product_name = btrim(product_name) AND product_name <> ''),
  CONSTRAINT products_purchase_price_check CHECK (purchase_price >= 0),
  CONSTRAINT products_carton_qty_check CHECK (carton_qty >= 1),
  CONSTRAINT products_shipping_fee_check CHECK (default_shipping_fee >= 0),
  CONSTRAINT products_vat_type_check CHECK (vat_type IN ('INCLUDED', 'EXCLUDED', 'ZERO')),
  CONSTRAINT products_shipping_type_check CHECK (
    default_shipping_type IN ('PARCEL', 'FREE', 'COLLECT', 'TRUCK', 'MANUAL')
  ),
  CONSTRAINT products_barcode_not_blank CHECK (
    barcode IS NULL OR (barcode = btrim(barcode) AND barcode <> '')
  )
);

CREATE UNIQUE INDEX products_barcode_unique ON products (barcode)
WHERE barcode IS NOT NULL;

CREATE INDEX products_supplier_id_idx ON products (supplier_id);
CREATE INDEX products_is_active_idx ON products (is_active);
CREATE INDEX suppliers_is_active_idx ON suppliers (is_active);

CREATE TABLE product_cost_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products (id),
  old_price INTEGER NOT NULL,
  new_price INTEGER NOT NULL,
  reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_cost_history_old_price_check CHECK (old_price >= 0),
  CONSTRAINT product_cost_history_new_price_check CHECK (new_price >= 0)
);

CREATE INDEX product_cost_history_product_changed_idx
  ON product_cost_history (product_id, changed_at DESC);

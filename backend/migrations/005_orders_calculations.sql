CREATE TABLE orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_import_id BIGINT NOT NULL,
  client_id BIGINT NOT NULL,
  order_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  shipping_type TEXT NOT NULL,
  shipping_calculation_mode TEXT NOT NULL,
  manual_shipping_charge INTEGER,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  total_product_sales BIGINT NOT NULL DEFAULT 0,
  total_product_cost BIGINT NOT NULL DEFAULT 0,
  total_product_margin BIGINT NOT NULL DEFAULT 0,
  total_product_margin_rate NUMERIC(8, 2) NOT NULL DEFAULT 0,
  total_shipping_charge BIGINT NOT NULL DEFAULT 0,
  total_invoice_amount BIGINT NOT NULL DEFAULT 0,
  invoice_product_line_count INTEGER NOT NULL DEFAULT 0,
  invoice_shipping_line_count INTEGER NOT NULL DEFAULT 0,
  invoice_required_line_count INTEGER NOT NULL DEFAULT 0,
  preview_signature TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_order_import_id_fkey
    FOREIGN KEY (order_import_id) REFERENCES order_imports (id),
  CONSTRAINT orders_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES sales_clients (id),
  CONSTRAINT orders_order_import_id_key UNIQUE (order_import_id),
  CONSTRAINT orders_status_check CHECK (
    status IN ('DRAFT', 'CONFIRMED', 'CANCELLED')
  ),
  CONSTRAINT orders_shipping_type_check CHECK (
    shipping_type IN ('PARCEL', 'FREE', 'COLLECT', 'TRUCK', 'MANUAL')
  ),
  CONSTRAINT orders_shipping_calc_check CHECK (
    shipping_calculation_mode IN ('TOTAL_QUANTITY', 'PER_ORDER', 'PER_ADDRESS')
  ),
  CONSTRAINT orders_manual_shipping_check CHECK (
    manual_shipping_charge IS NULL OR manual_shipping_charge >= 0
  ),
  CONSTRAINT orders_total_quantity_check CHECK (total_quantity >= 0)
);

CREATE INDEX orders_client_id_idx ON orders (client_id);
CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX orders_order_date_idx ON orders (order_date);

CREATE TABLE order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL,
  source_import_row_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  product_code_snapshot TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  option_name_snapshot TEXT,
  quantity INTEGER NOT NULL,
  purchase_price_snapshot INTEGER NOT NULL,
  sale_price_snapshot INTEGER NOT NULL,
  price_source_id BIGINT,
  carton_qty_snapshot INTEGER NOT NULL,
  shipping_fee_per_carton_snapshot INTEGER NOT NULL,
  shipping_fee_source TEXT NOT NULL,
  product_sales_amount BIGINT NOT NULL,
  product_cost_amount BIGINT NOT NULL,
  product_margin_amount BIGINT NOT NULL,
  product_margin_rate NUMERIC(8, 2) NOT NULL,
  external_order_number TEXT,
  recipient_name TEXT,
  phone TEXT,
  address TEXT,
  shipping_memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_items_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT order_items_source_row_fkey
    FOREIGN KEY (source_import_row_id) REFERENCES order_import_rows (id),
  CONSTRAINT order_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT order_items_price_source_fkey
    FOREIGN KEY (price_source_id) REFERENCES client_product_prices (id),
  CONSTRAINT order_items_quantity_check CHECK (quantity >= 1),
  CONSTRAINT order_items_prices_check CHECK (
    purchase_price_snapshot >= 0 AND sale_price_snapshot >= 0
  ),
  CONSTRAINT order_items_carton_qty_check CHECK (carton_qty_snapshot >= 1),
  CONSTRAINT order_items_shipping_fee_check CHECK (shipping_fee_per_carton_snapshot >= 0),
  CONSTRAINT order_items_shipping_fee_source_check CHECK (
    shipping_fee_source IN ('CLIENT_OVERRIDE', 'PRODUCT_DEFAULT')
  ),
  CONSTRAINT order_items_source_row_unique UNIQUE (order_id, source_import_row_id)
);

CREATE INDEX order_items_order_id_idx ON order_items (order_id);
CREATE INDEX order_items_product_id_idx ON order_items (product_id);

CREATE TABLE order_shipping_groups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL,
  shipping_calculation_mode TEXT NOT NULL,
  group_key TEXT NOT NULL,
  product_id BIGINT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  option_name_snapshot TEXT,
  total_quantity INTEGER NOT NULL,
  carton_qty_snapshot INTEGER NOT NULL,
  carton_count INTEGER NOT NULL,
  shipping_fee_per_carton_snapshot INTEGER NOT NULL,
  shipping_fee_source TEXT NOT NULL,
  shipping_charge BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_shipping_groups_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT order_shipping_groups_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT order_shipping_groups_mode_check CHECK (
    shipping_calculation_mode IN ('TOTAL_QUANTITY', 'PER_ORDER', 'PER_ADDRESS')
  ),
  CONSTRAINT order_shipping_groups_qty_check CHECK (total_quantity >= 1),
  CONSTRAINT order_shipping_groups_carton_check CHECK (
    carton_qty_snapshot >= 1 AND carton_count >= 1
  ),
  CONSTRAINT order_shipping_groups_fee_check CHECK (shipping_fee_per_carton_snapshot >= 0),
  CONSTRAINT order_shipping_groups_source_check CHECK (
    shipping_fee_source IN ('CLIENT_OVERRIDE', 'PRODUCT_DEFAULT')
  )
);

CREATE INDEX order_shipping_groups_order_id_idx ON order_shipping_groups (order_id);

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE sales_clients (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_code TEXT NOT NULL,
  client_name TEXT NOT NULL,
  business_number TEXT,
  ceo_name TEXT,
  address TEXT,
  manager_name TEXT,
  phone TEXT,
  email TEXT,
  default_shipping_type TEXT NOT NULL DEFAULT 'PARCEL',
  shipping_calculation_mode TEXT NOT NULL DEFAULT 'TOTAL_QUANTITY',
  settlement_type TEXT NOT NULL DEFAULT 'POSTPAID',
  memo TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_clients_client_code_key UNIQUE (client_code),
  CONSTRAINT sales_clients_client_code_not_blank CHECK (client_code = btrim(client_code) AND client_code <> ''),
  CONSTRAINT sales_clients_client_name_not_blank CHECK (client_name = btrim(client_name) AND client_name <> ''),
  CONSTRAINT sales_clients_shipping_type_check CHECK (
    default_shipping_type IN ('PARCEL', 'FREE', 'COLLECT', 'TRUCK', 'MANUAL')
  ),
  CONSTRAINT sales_clients_shipping_calc_check CHECK (
    shipping_calculation_mode IN ('TOTAL_QUANTITY', 'PER_ORDER', 'PER_ADDRESS')
  ),
  CONSTRAINT sales_clients_settlement_check CHECK (
    settlement_type IN ('PREPAID', 'POSTPAID', 'OTHER')
  )
);

CREATE INDEX sales_clients_is_active_idx ON sales_clients (is_active);

CREATE TABLE client_product_prices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  sale_price INTEGER NOT NULL,
  shipping_fee_override INTEGER,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_product_prices_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES sales_clients (id),
  CONSTRAINT client_product_prices_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT client_product_prices_sale_price_check CHECK (sale_price >= 0),
  CONSTRAINT client_product_prices_shipping_override_check CHECK (
    shipping_fee_override IS NULL OR shipping_fee_override >= 0
  ),
  CONSTRAINT client_product_prices_period_check CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT client_product_prices_no_overlap EXCLUDE USING gist (
    client_id WITH =,
    product_id WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  )
);

CREATE INDEX client_product_prices_lookup_idx
  ON client_product_prices (client_id, product_id, effective_from);

CREATE INDEX client_product_prices_client_from_idx
  ON client_product_prices (client_id, effective_from);

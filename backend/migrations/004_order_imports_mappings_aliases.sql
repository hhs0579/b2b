CREATE TABLE excel_mappings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL,
  mapping_name TEXT NOT NULL DEFAULT 'default',
  sheet_name TEXT,
  header_row_number INTEGER NOT NULL DEFAULT 1,
  column_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT excel_mappings_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES sales_clients (id),
  CONSTRAINT excel_mappings_header_row_check CHECK (header_row_number >= 1)
);

CREATE UNIQUE INDEX excel_mappings_one_active_per_client_idx
  ON excel_mappings (client_id)
  WHERE is_active;

CREATE INDEX excel_mappings_client_idx ON excel_mappings (client_id);

CREATE TABLE product_aliases (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL,
  external_product_code TEXT,
  external_product_name TEXT,
  external_option_name TEXT,
  normalized_product_code TEXT NOT NULL DEFAULT '',
  normalized_product_name TEXT NOT NULL DEFAULT '',
  normalized_option_name TEXT NOT NULL DEFAULT '',
  product_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_aliases_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES sales_clients (id),
  CONSTRAINT product_aliases_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT product_aliases_normalized_key UNIQUE (
    client_id,
    normalized_product_code,
    normalized_product_name,
    normalized_option_name
  )
);

CREATE INDEX product_aliases_client_idx ON product_aliases (client_id);
CREATE INDEX product_aliases_product_idx ON product_aliases (product_id);

CREATE TABLE order_imports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL,
  order_date DATE NOT NULL,
  original_file_name TEXT NOT NULL,
  stored_file_name TEXT NOT NULL,
  stored_file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  sheet_name TEXT,
  header_row_number INTEGER,
  column_map JSONB,
  status TEXT NOT NULL DEFAULT 'UPLOADED',
  duplicate_hash_detected BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  source_row_count INTEGER NOT NULL DEFAULT 0,
  parsed_row_count INTEGER NOT NULL DEFAULT 0,
  valid_row_count INTEGER NOT NULL DEFAULT 0,
  invalid_row_count INTEGER NOT NULL DEFAULT 0,
  matched_row_count INTEGER NOT NULL DEFAULT 0,
  unmatched_row_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_imports_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES sales_clients (id),
  CONSTRAINT order_imports_status_check CHECK (
    status IN ('UPLOADED', 'MAPPING_REQUIRED', 'PARSED', 'READY', 'ERROR')
  ),
  CONSTRAINT order_imports_file_size_check CHECK (file_size >= 0),
  CONSTRAINT order_imports_header_row_check CHECK (
    header_row_number IS NULL OR header_row_number >= 1
  )
);

CREATE INDEX order_imports_client_hash_idx ON order_imports (client_id, file_hash);
CREATE INDEX order_imports_client_created_idx ON order_imports (client_id, created_at DESC);

CREATE TABLE order_import_rows (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_import_id BIGINT NOT NULL,
  source_sheet_name TEXT NOT NULL,
  source_row_number INTEGER NOT NULL,
  external_order_number TEXT,
  external_product_code TEXT,
  external_product_name TEXT,
  external_option_name TEXT,
  quantity INTEGER,
  recipient_name TEXT,
  phone TEXT,
  address TEXT,
  shipping_memo TEXT,
  matched_product_id BIGINT,
  match_status TEXT NOT NULL DEFAULT 'UNMATCHED',
  validation_status TEXT NOT NULL DEFAULT 'INVALID',
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_row_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_import_rows_import_id_fkey
    FOREIGN KEY (order_import_id) REFERENCES order_imports (id),
  CONSTRAINT order_import_rows_product_id_fkey
    FOREIGN KEY (matched_product_id) REFERENCES products (id),
  CONSTRAINT order_import_rows_match_status_check CHECK (
    match_status IN (
      'MATCHED_ALIAS',
      'MATCHED_PRODUCT_CODE',
      'MATCHED_EXACT',
      'UNMATCHED',
      'MANUAL',
      'MATCHED_BUT_INACTIVE'
    )
  ),
  CONSTRAINT order_import_rows_validation_status_check CHECK (
    validation_status IN ('VALID', 'INVALID')
  ),
  CONSTRAINT order_import_rows_source_row_key UNIQUE (
    order_import_id,
    source_sheet_name,
    source_row_number
  )
);

CREATE INDEX order_import_rows_import_idx ON order_import_rows (order_import_id);
CREATE INDEX order_import_rows_match_idx ON order_import_rows (order_import_id, match_status);

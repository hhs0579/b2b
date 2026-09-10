ALTER TABLE excel_mappings
  ADD COLUMN IF NOT EXISTS header_start_row INTEGER,
  ADD COLUMN IF NOT EXISTS header_end_row INTEGER,
  ADD COLUMN IF NOT EXISTS data_start_row INTEGER,
  ADD COLUMN IF NOT EXISTS mapping_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE excel_mappings
SET
  header_start_row = COALESCE(header_start_row, header_row_number, 1),
  header_end_row = COALESCE(header_end_row, header_row_number, 1),
  data_start_row = COALESCE(data_start_row, COALESCE(header_row_number, 1) + 1);

ALTER TABLE excel_mappings
  ALTER COLUMN header_start_row SET DEFAULT 1,
  ALTER COLUMN header_end_row SET DEFAULT 1,
  ALTER COLUMN data_start_row SET DEFAULT 2;

ALTER TABLE excel_mappings
  DROP CONSTRAINT IF EXISTS excel_mappings_header_range_check;
ALTER TABLE excel_mappings
  ADD CONSTRAINT excel_mappings_header_range_check CHECK (
    header_start_row >= 1
    AND header_end_row >= header_start_row
    AND data_start_row > header_end_row
  );

ALTER TABLE order_imports
  ADD COLUMN IF NOT EXISTS header_start_row INTEGER,
  ADD COLUMN IF NOT EXISTS header_end_row INTEGER,
  ADD COLUMN IF NOT EXISTS data_start_row INTEGER,
  ADD COLUMN IF NOT EXISTS mapping_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE order_imports
SET
  header_start_row = COALESCE(header_start_row, header_row_number, 1),
  header_end_row = COALESCE(header_end_row, header_row_number, 1),
  data_start_row = COALESCE(
    data_start_row,
    CASE WHEN header_row_number IS NOT NULL THEN header_row_number + 1 ELSE 2 END
  );

ALTER TABLE order_imports
  DROP CONSTRAINT IF EXISTS order_imports_header_range_check;
ALTER TABLE order_imports
  ADD CONSTRAINT order_imports_header_range_check CHECK (
    header_start_row IS NULL
    OR (
      header_start_row >= 1
      AND header_end_row >= header_start_row
      AND data_start_row > header_end_row
    )
  );

ALTER TABLE order_import_rows
  DROP CONSTRAINT IF EXISTS order_import_rows_match_status_check;
ALTER TABLE order_import_rows
  ADD CONSTRAINT order_import_rows_match_status_check CHECK (
    match_status IN (
      'MATCHED_ALIAS',
      'MATCHED_PRODUCT_CODE',
      'MATCHED_BARCODE',
      'MATCHED_EXACT',
      'UNMATCHED',
      'MANUAL',
      'MATCHED_BUT_INACTIVE'
    )
  );

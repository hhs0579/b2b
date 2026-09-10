-- Keep order_import_rows.quantity as the effective quantity.
-- parsed_quantity = Excel parse result, manual_quantity = user override.

ALTER TABLE order_import_rows
  ADD COLUMN IF NOT EXISTS parsed_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS manual_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS quantity_source TEXT NOT NULL DEFAULT 'PARSED';

UPDATE order_import_rows
SET parsed_quantity = quantity
WHERE parsed_quantity IS NULL AND quantity IS NOT NULL;

ALTER TABLE order_import_rows
  DROP CONSTRAINT IF EXISTS order_import_rows_quantity_source_check;
ALTER TABLE order_import_rows
  ADD CONSTRAINT order_import_rows_quantity_source_check
  CHECK (quantity_source IN ('PARSED', 'MANUAL'));

ALTER TABLE order_import_rows
  DROP CONSTRAINT IF EXISTS order_import_rows_parsed_quantity_check;
ALTER TABLE order_import_rows
  ADD CONSTRAINT order_import_rows_parsed_quantity_check
  CHECK (parsed_quantity IS NULL OR parsed_quantity >= 1);

ALTER TABLE order_import_rows
  DROP CONSTRAINT IF EXISTS order_import_rows_manual_quantity_check;
ALTER TABLE order_import_rows
  ADD CONSTRAINT order_import_rows_manual_quantity_check
  CHECK (manual_quantity IS NULL OR manual_quantity >= 1);

ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_action_check CHECK (
    action IN ('DELETE', 'DEACTIVATE', 'REACTIVATE', 'CANCEL', 'QUANTITY_OVERRIDE')
  );

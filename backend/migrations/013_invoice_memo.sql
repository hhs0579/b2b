ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoice_shipping_method TEXT,
  ADD COLUMN IF NOT EXISTS invoice_ship_date DATE,
  ADD COLUMN IF NOT EXISTS invoice_destination TEXT,
  ADD COLUMN IF NOT EXISTS invoice_manager TEXT;

ALTER TABLE generated_documents
  ADD COLUMN IF NOT EXISTS invoice_metadata_snapshot JSONB;

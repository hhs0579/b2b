CREATE TABLE invoice_supplier_profiles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_code TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  business_registration_number TEXT,
  representative_name TEXT,
  business_address TEXT,
  business_type TEXT,
  business_item TEXT,
  phone TEXT,
  fax TEXT,
  email TEXT,
  bank_name TEXT,
  bank_account TEXT,
  bank_account_holder TEXT,
  stamp_image_path TEXT,
  template_code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_supplier_profiles_code_key UNIQUE (supplier_code)
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoice_supplier_profile_id BIGINT;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_invoice_supplier_profile_id_fkey;

ALTER TABLE orders
  ADD CONSTRAINT orders_invoice_supplier_profile_id_fkey
    FOREIGN KEY (invoice_supplier_profile_id) REFERENCES invoice_supplier_profiles (id);

ALTER TABLE generated_documents
  ADD COLUMN IF NOT EXISTS supplier_profile_id BIGINT,
  ADD COLUMN IF NOT EXISTS supplier_code_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS supplier_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS supplier_profile_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS template_code TEXT,
  ADD COLUMN IF NOT EXISTS stamp_hash TEXT;

ALTER TABLE generated_documents
  DROP CONSTRAINT IF EXISTS generated_documents_supplier_profile_id_fkey;

ALTER TABLE generated_documents
  ADD CONSTRAINT generated_documents_supplier_profile_id_fkey
    FOREIGN KEY (supplier_profile_id) REFERENCES invoice_supplier_profiles (id);

INSERT INTO invoice_supplier_profiles (
  supplier_code, supplier_name, business_registration_number, representative_name,
  business_address, business_type, business_item, phone, fax, email,
  bank_name, bank_account, bank_account_holder, stamp_image_path, template_code, is_active
) VALUES
(
  'ESSER',
  '에쎄르',
  '108-81-62352',
  '김동욱',
  '경기도 김포시 양촌읍 황금로 323번길 15',
  '도소매',
  '잡화',
  '02-322-8285',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'stamps/esser_stamp.jpeg',
  'ESSER',
  TRUE
),
(
  'BESTHEIM',
  '베스트하임',
  '562-81-01919',
  '김성준',
  '경기도 김포시 양촌읍 황금로 323번길 15',
  '도소매',
  '잡화',
  '02-322-8285',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'stamps/bestheim_stamp.png',
  'BESTHEIM',
  TRUE
)
ON CONFLICT (supplier_code) DO NOTHING;

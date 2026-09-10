ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE order_shipping_groups
  ADD COLUMN IF NOT EXISTS shipping_type TEXT,
  ADD COLUMN IF NOT EXISTS shipping_type_source TEXT,
  ADD COLUMN IF NOT EXISTS truck_group_key TEXT,
  ADD COLUMN IF NOT EXISTS manual_shipping_charge INTEGER,
  ADD COLUMN IF NOT EXISTS group_note TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE order_shipping_groups
  DROP CONSTRAINT IF EXISTS order_shipping_groups_shipping_type_check;
ALTER TABLE order_shipping_groups
  ADD CONSTRAINT order_shipping_groups_shipping_type_check
  CHECK (shipping_type IS NULL OR shipping_type IN ('PARCEL', 'FREE', 'COLLECT', 'TRUCK', 'MANUAL'));

ALTER TABLE order_shipping_groups
  DROP CONSTRAINT IF EXISTS order_shipping_groups_shipping_type_source_check;
ALTER TABLE order_shipping_groups
  ADD CONSTRAINT order_shipping_groups_shipping_type_source_check
  CHECK (shipping_type_source IS NULL OR shipping_type_source IN ('ORDER_DEFAULT', 'GROUP_OVERRIDE'));

ALTER TABLE order_shipping_groups
  DROP CONSTRAINT IF EXISTS order_shipping_groups_manual_charge_check;
ALTER TABLE order_shipping_groups
  ADD CONSTRAINT order_shipping_groups_manual_charge_check
  CHECK (manual_shipping_charge IS NULL OR manual_shipping_charge >= 0);

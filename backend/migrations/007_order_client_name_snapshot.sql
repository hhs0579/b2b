ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS client_name_snapshot TEXT;

UPDATE orders o
SET client_name_snapshot = c.client_name
FROM sales_clients c
WHERE o.client_id = c.id
  AND o.status = 'CONFIRMED'
  AND (o.client_name_snapshot IS NULL OR btrim(o.client_name_snapshot) = '');

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_confirmed_client_name_snapshot_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_confirmed_client_name_snapshot_check
  CHECK (
    status <> 'CONFIRMED'
    OR (client_name_snapshot IS NOT NULL AND btrim(client_name_snapshot) <> '')
  );

CREATE TABLE IF NOT EXISTS settlements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL,
  billing_amount BIGINT NOT NULL,
  paid_amount BIGINT NOT NULL DEFAULT 0,
  outstanding_amount BIGINT NOT NULL,
  settlement_status TEXT NOT NULL DEFAULT 'UNPAID',
  expected_payment_date DATE,
  last_payment_date DATE,
  tax_invoice_status TEXT NOT NULL DEFAULT 'NOT_ISSUED',
  tax_invoice_issued_at TIMESTAMPTZ,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settlements_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT settlements_order_id_key UNIQUE (order_id),
  CONSTRAINT settlements_status_check CHECK (
    settlement_status IN ('UNPAID', 'PARTIAL', 'PAID')
  ),
  CONSTRAINT settlements_tax_status_check CHECK (
    tax_invoice_status IN ('NOT_ISSUED', 'ISSUED')
  ),
  CONSTRAINT settlements_billing_check CHECK (billing_amount >= 0),
  CONSTRAINT settlements_paid_check CHECK (paid_amount >= 0),
  CONSTRAINT settlements_no_overpay_check CHECK (paid_amount <= billing_amount),
  CONSTRAINT settlements_outstanding_check CHECK (
    outstanding_amount = billing_amount - paid_amount
  )
);

CREATE INDEX IF NOT EXISTS settlements_status_idx ON settlements (settlement_status);
CREATE INDEX IF NOT EXISTS settlements_expected_payment_date_idx ON settlements (expected_payment_date);
CREATE INDEX IF NOT EXISTS settlements_tax_status_idx ON settlements (tax_invoice_status);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  settlement_id BIGINT NOT NULL,
  amount BIGINT NOT NULL,
  paid_at DATE NOT NULL,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_transactions_settlement_id_fkey
    FOREIGN KEY (settlement_id) REFERENCES settlements (id),
  CONSTRAINT payment_transactions_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS payment_transactions_settlement_id_idx ON payment_transactions (settlement_id);
CREATE INDEX IF NOT EXISTS payment_transactions_paid_at_idx ON payment_transactions (paid_at);

INSERT INTO settlements (
  order_id, billing_amount, paid_amount, outstanding_amount, settlement_status
)
SELECT
  o.id,
  o.total_invoice_amount,
  0,
  o.total_invoice_amount,
  'UNPAID'
FROM orders o
WHERE o.status = 'CONFIRMED'
  AND NOT EXISTS (
    SELECT 1 FROM settlements s WHERE s.order_id = o.id
  );

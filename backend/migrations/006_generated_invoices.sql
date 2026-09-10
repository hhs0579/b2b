ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoice_note TEXT;

CREATE TABLE generated_documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL,
  document_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  original_file_name TEXT NOT NULL,
  stored_file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  template_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'GENERATED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT generated_documents_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT generated_documents_type_check CHECK (document_type IN ('INVOICE')),
  CONSTRAINT generated_documents_status_check CHECK (
    status IN ('GENERATED', 'INVALID', 'SUPERSEDED')
  ),
  CONSTRAINT generated_documents_order_version_key UNIQUE (order_id, document_type, version),
  CONSTRAINT generated_documents_version_check CHECK (version >= 1),
  CONSTRAINT generated_documents_file_size_check CHECK (file_size >= 0)
);

CREATE INDEX generated_documents_order_id_idx ON generated_documents (order_id);
CREATE INDEX generated_documents_status_idx ON generated_documents (status);

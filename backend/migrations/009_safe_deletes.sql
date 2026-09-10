CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  before_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_logs_entity_type_not_blank CHECK (
    entity_type = btrim(entity_type) AND entity_type <> ''
  ),
  CONSTRAINT audit_logs_action_check CHECK (
    action IN ('DELETE', 'DEACTIVATE', 'REACTIVATE', 'CANCEL')
  )
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS storage_orphan_files (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stored_file_name TEXT NOT NULL,
  file_kind TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT storage_orphan_files_kind_check CHECK (
    file_kind IN ('ORDER_UPLOAD')
  )
);

CREATE INDEX IF NOT EXISTS storage_orphan_files_created_idx ON storage_orphan_files (created_at DESC);

ALTER TABLE generated_documents
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

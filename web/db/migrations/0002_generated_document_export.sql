CREATE TABLE IF NOT EXISTS generated_document_export (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  generated_document_id UUID NOT NULL REFERENCES generated_document(id) ON DELETE CASCADE,
  requested_by_user_id UUID REFERENCES app_user(id),
  format TEXT NOT NULL CHECK (format IN ('docx', 'pdf')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  storage_key TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generated_document_export_tenant_id
  ON generated_document_export (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_document_export_document_id
  ON generated_document_export (generated_document_id, created_at DESC);

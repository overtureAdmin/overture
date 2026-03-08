CREATE TABLE IF NOT EXISTS llm_org_prompt (
  organization_id UUID PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  updated_by_subject TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_workflow_orchestration (
  id INT PRIMARY KEY CHECK (id = 1),
  policy JSONB NOT NULL,
  updated_by_subject TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_batch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES thread(id) ON DELETE SET NULL,
  document_id UUID REFERENCES generated_document(id) ON DELETE SET NULL,
  requested_by_subject TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual', 'document_generate', 'chat')) DEFAULT 'manual',
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'blocked', 'canceled')) DEFAULT 'queued',
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt_snapshot TEXT NOT NULL DEFAULT '',
  n8n_execution_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workflow_batch_org_created_at
  ON workflow_batch (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_batch_thread_created_at
  ON workflow_batch (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_batch_status_created_at
  ON workflow_batch (status, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_batch_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES workflow_batch(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_batch_audit_batch_created_at
  ON workflow_batch_audit (batch_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unity_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE llm_org_prompt TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE admin_workflow_orchestration TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workflow_batch TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workflow_batch_audit TO unity_app;
  END IF;
END $$;

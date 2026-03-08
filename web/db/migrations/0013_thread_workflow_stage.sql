CREATE TABLE IF NOT EXISTS thread_workflow_stage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL CHECK (stage_key IN ('intake_review', 'evidence_plan', 'draft_plan')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'blocked', 'ready', 'complete')),
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (thread_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_thread_workflow_stage_tenant_thread
  ON thread_workflow_stage (tenant_id, thread_id, updated_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unity_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE thread_workflow_stage TO unity_app;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS super_admin_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  organization_id UUID,
  target_auth_subject TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_super_admin_action_log_created_at
  ON super_admin_action_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_super_admin_action_log_org_created_at
  ON super_admin_action_log (organization_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unity_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE super_admin_action_log TO unity_app;
  END IF;
END
$$;

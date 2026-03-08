CREATE TABLE IF NOT EXISTS admin_workflow_policy (
  id INT PRIMARY KEY CHECK (id = 1),
  policy JSONB NOT NULL,
  updated_by_subject TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unity_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE admin_workflow_policy TO unity_app;
  END IF;
END $$;

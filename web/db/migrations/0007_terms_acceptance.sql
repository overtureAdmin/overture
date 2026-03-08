CREATE TABLE IF NOT EXISTS terms_of_use_acceptance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  auth_subject TEXT NOT NULL REFERENCES user_identity(auth_subject) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_terms_acceptance_org_subject
  ON terms_of_use_acceptance (organization_id, auth_subject, accepted_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unity_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE terms_of_use_acceptance TO unity_app;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS organization_user_invite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('org_owner', 'org_admin', 'case_contributor', 'reviewer', 'read_only')) DEFAULT 'case_contributor',
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'canceled', 'expired', 'failed')) DEFAULT 'pending',
  invited_by_subject TEXT REFERENCES user_identity(auth_subject) ON DELETE SET NULL,
  cognito_username TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  accepted_by_subject TEXT REFERENCES user_identity(auth_subject) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_user_invite_pending_unique
  ON organization_user_invite (organization_id, normalized_email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_org_user_invite_org_status
  ON organization_user_invite (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_user_invite_email
  ON organization_user_invite (normalized_email, status, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unity_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization_user_invite TO unity_app;
  END IF;
END
$$;

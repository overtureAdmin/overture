ALTER TABLE onboarding_state
  ADD COLUMN IF NOT EXISTS organization_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pending_join_request_id UUID;

CREATE TABLE IF NOT EXISTS organization_invite_code (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  default_role TEXT NOT NULL CHECK (default_role IN ('org_owner', 'org_admin', 'case_contributor', 'reviewer', 'read_only')) DEFAULT 'case_contributor',
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')) DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 100,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_by_subject TEXT REFERENCES user_identity(auth_subject) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_join_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  auth_subject TEXT NOT NULL REFERENCES user_identity(auth_subject) ON DELETE CASCADE,
  email TEXT,
  invite_code_id UUID REFERENCES organization_invite_code(id) ON DELETE SET NULL,
  requested_role TEXT NOT NULL CHECK (requested_role IN ('org_owner', 'org_admin', 'case_contributor', 'reviewer', 'read_only')) DEFAULT 'case_contributor',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  reviewed_by_subject TEXT REFERENCES user_identity(auth_subject) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_join_request_pending_unique
  ON organization_join_request (organization_id, auth_subject)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_org_invite_code_org
  ON organization_invite_code (organization_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_org_join_request_org_status
  ON organization_join_request (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_join_request_subject
  ON organization_join_request (auth_subject, status, created_at DESC);

UPDATE onboarding_state
SET organization_confirmed_at = COALESCE(organization_confirmed_at, completed_at, NOW())
WHERE organization_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unity_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization_invite_code TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization_join_request TO unity_app;
  END IF;
END
$$;

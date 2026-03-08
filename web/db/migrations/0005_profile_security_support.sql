CREATE TABLE IF NOT EXISTS user_profile (
  auth_subject TEXT PRIMARY KEY REFERENCES user_identity(auth_subject) ON DELETE CASCADE,
  salutation TEXT,
  first_name TEXT,
  last_name TEXT,
  timezone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profile_change_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  auth_subject TEXT NOT NULL REFERENCES user_identity(auth_subject) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('email_change', 'profile_unlock')),
  requested_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('open', 'approved', 'rejected', 'canceled')) DEFAULT 'open',
  reviewed_by_subject TEXT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_impersonation_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  support_subject TEXT NOT NULL,
  target_organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
  target_auth_subject TEXT REFERENCES user_identity(auth_subject) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'ended')) DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_profile_change_request_org_status
  ON profile_change_request (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_change_request_subject
  ON profile_change_request (auth_subject, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_impersonation_support_subject
  ON support_impersonation_session (support_subject, status, started_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unity_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_profile TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE profile_change_request TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE support_impersonation_session TO unity_app;
  END IF;
END
$$;

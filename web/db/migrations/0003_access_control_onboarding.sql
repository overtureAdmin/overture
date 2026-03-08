CREATE TABLE IF NOT EXISTS organization (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('solo', 'enterprise')) DEFAULT 'solo',
  status TEXT NOT NULL CHECK (status IN ('verified', 'pending_verification', 'suspended')) DEFAULT 'verified',
  created_by_subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_identity (
  auth_subject TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  home_organization_id UUID REFERENCES organization(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_membership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  auth_subject TEXT NOT NULL REFERENCES user_identity(auth_subject) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('org_owner', 'org_admin', 'case_contributor', 'reviewer', 'read_only')),
  status TEXT NOT NULL CHECK (status IN ('active', 'invited', 'disabled')) DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, auth_subject)
);

CREATE TABLE IF NOT EXISTS baa_acceptance (
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

CREATE TABLE IF NOT EXISTS org_subscription (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE UNIQUE,
  plan_code TEXT NOT NULL DEFAULT 'solo_monthly',
  status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')) DEFAULT 'trialing',
  provider TEXT NOT NULL DEFAULT 'manual',
  external_subscription_id TEXT,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_state (
  auth_subject TEXT PRIMARY KEY REFERENCES user_identity(auth_subject) ON DELETE CASCADE,
  organization_id UUID REFERENCES organization(id) ON DELETE SET NULL,
  legal_name TEXT,
  job_title TEXT,
  organization_name TEXT,
  phone TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enterprise_contact_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject TEXT REFERENCES user_identity(auth_subject) ON DELETE SET NULL,
  email TEXT,
  organization_name TEXT NOT NULL,
  request_notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_review', 'closed')) DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organization_membership_org_subject
  ON organization_membership (organization_id, auth_subject);
CREATE INDEX IF NOT EXISTS idx_organization_membership_subject
  ON organization_membership (auth_subject, status);
CREATE INDEX IF NOT EXISTS idx_baa_acceptance_org_subject
  ON baa_acceptance (organization_id, auth_subject, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_subscription_org_status
  ON org_subscription (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_onboarding_state_org
  ON onboarding_state (organization_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_contact_request_status
  ON enterprise_contact_request (status, created_at DESC);

INSERT INTO organization (id, slug, name, account_type, status, created_at, updated_at)
SELECT t.id, t.slug, t.name, 'solo', 'verified', t.created_at, t.updated_at
FROM tenant t
ON CONFLICT (id) DO NOTHING;

WITH ranked_users AS (
  SELECT
    au.auth_subject,
    au.email,
    au.display_name,
    au.tenant_id,
    ROW_NUMBER() OVER (PARTITION BY au.auth_subject ORDER BY au.updated_at DESC) AS rn
  FROM app_user au
)
INSERT INTO user_identity (auth_subject, email, display_name, home_organization_id)
SELECT ru.auth_subject, ru.email, ru.display_name, ru.tenant_id
FROM ranked_users ru
WHERE ru.rn = 1
ON CONFLICT (auth_subject) DO UPDATE
SET email = EXCLUDED.email,
    display_name = COALESCE(EXCLUDED.display_name, user_identity.display_name),
    updated_at = NOW();

INSERT INTO organization_membership (organization_id, auth_subject, role, status)
SELECT
  au.tenant_id,
  au.auth_subject,
  CASE
    WHEN au.role = 'owner' THEN 'org_owner'
    WHEN au.role = 'admin' THEN 'org_admin'
    WHEN au.role = 'reviewer' THEN 'reviewer'
    WHEN au.role = 'viewer' THEN 'read_only'
    ELSE 'case_contributor'
  END,
  'active'
FROM app_user au
ON CONFLICT (organization_id, auth_subject) DO UPDATE
SET role = EXCLUDED.role,
    status = 'active',
    updated_at = NOW();

INSERT INTO org_subscription (organization_id, plan_code, status, provider)
SELECT o.id, 'legacy_grandfathered', 'active', 'manual'
FROM organization o
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO onboarding_state (auth_subject, organization_id, completed_at)
SELECT ui.auth_subject, ui.home_organization_id, NOW()
FROM user_identity ui
ON CONFLICT (auth_subject) DO NOTHING;

INSERT INTO baa_acceptance (organization_id, auth_subject, legal_name, signer_email, version, accepted_at)
SELECT
  ui.home_organization_id,
  ui.auth_subject,
  COALESCE(ui.display_name, ui.email, ui.auth_subject),
  COALESCE(ui.email, CONCAT(ui.auth_subject, '@local.invalid')),
  'legacy-implicit-2026-02-28',
  NOW()
FROM user_identity ui
WHERE ui.home_organization_id IS NOT NULL
ON CONFLICT DO NOTHING;

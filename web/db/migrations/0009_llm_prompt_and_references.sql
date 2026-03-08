CREATE TABLE IF NOT EXISTS llm_master_prompt (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  prompt TEXT NOT NULL,
  updated_by_subject TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO llm_master_prompt (id, prompt, updated_by_subject)
VALUES (
  1,
  'You are Unity Appeals assistant. Produce concise, clinically grounded, policy-aware prior-authorization appeal content. PHI processing is disabled: never include patient-identifying details.',
  'system'
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS llm_user_prompt (
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  auth_subject TEXT NOT NULL,
  prompt TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, auth_subject)
);

CREATE TABLE IF NOT EXISTS llm_user_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  auth_subject TEXT NOT NULL,
  reference_kind TEXT NOT NULL CHECK (reference_kind IN ('link', 'document')),
  title TEXT NOT NULL,
  reference_value TEXT NOT NULL,
  usage_note TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_user_prompt_org_subject
  ON llm_user_prompt (organization_id, auth_subject);

CREATE INDEX IF NOT EXISTS idx_llm_user_reference_org_subject
  ON llm_user_reference (organization_id, auth_subject, sort_order, created_at);

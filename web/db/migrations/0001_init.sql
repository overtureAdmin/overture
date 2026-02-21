CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phi_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  auth_subject TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, auth_subject)
);

CREATE TABLE IF NOT EXISTS patient_case (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  patient_name TEXT,
  insurer_name TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_by_user_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS thread (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  patient_case_id UUID REFERENCES patient_case(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  created_by_user_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  user_id UUID REFERENCES app_user(id),
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  patient_case_id UUID REFERENCES patient_case(id) ON DELETE SET NULL,
  uploaded_by_user_id UUID REFERENCES app_user(id),
  storage_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum TEXT,
  ingest_status TEXT NOT NULL DEFAULT 'queued',
  malware_scan_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('lmn', 'appeal', 'p2p')),
  version INT NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES app_user(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_user_tenant_id ON app_user(tenant_id);
CREATE INDEX IF NOT EXISTS idx_patient_case_tenant_id ON patient_case(tenant_id);
CREATE INDEX IF NOT EXISTS idx_thread_tenant_id_updated_at ON thread(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_thread_id_created_at ON message(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_message_tenant_id ON message(tenant_id);
CREATE INDEX IF NOT EXISTS idx_source_document_tenant_id ON source_document(tenant_id);
CREATE INDEX IF NOT EXISTS idx_generated_document_tenant_id ON generated_document(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_event_tenant_id_created_at ON audit_event(tenant_id, created_at DESC);

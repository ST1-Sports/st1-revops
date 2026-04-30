-- Command Center supporting tables
-- Run once via: supabase db push  OR  psql $DATABASE_URL -f this_file.sql

CREATE TABLE IF NOT EXISTS custom_tools (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT    NOT NULL,
  capabilities TEXT[]  NOT NULL,
  type         TEXT    NOT NULL,
  config       JSONB   NOT NULL DEFAULT '{}',
  enabled      BOOLEAN DEFAULT TRUE,
  roles        TEXT[]  DEFAULT ARRAY['admin'],
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT,
  type         TEXT,
  subject      TEXT,
  body         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intel_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query        TEXT,
  result       TEXT,
  sources      JSONB DEFAULT '[]',
  tags         TEXT[],
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

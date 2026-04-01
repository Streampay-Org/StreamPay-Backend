CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE audit_action AS ENUM (
  'stream_create',
  'stream_update',
  'stream_admin_action'
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor varchar(255) NOT NULL,
  action audit_action NOT NULL,
  stream_id uuid,
  ip_address varchar(64) NOT NULL,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Append-only semantics: no UPDATE/DELETE statements are provided for this table.

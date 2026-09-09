ALTER TABLE streams ADD COLUMN IF NOT EXISTS tenant_id varchar(255);
CREATE INDEX IF NOT EXISTS streams_tenant_id_idx ON streams (tenant_id);

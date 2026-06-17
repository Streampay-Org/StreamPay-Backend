ALTER TABLE "streams" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
CREATE INDEX IF NOT EXISTS "streams_deleted_at_idx" ON "streams" ("deleted_at");

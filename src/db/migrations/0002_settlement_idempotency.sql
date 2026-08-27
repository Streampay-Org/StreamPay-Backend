-- Bind every processed settlement to its complete canonical payload and
-- retain an explicit claim state so retries can distinguish completed work,
-- active work, and safe-to-retry failures.
ALTER TABLE "processed_indexer_events"
  ADD COLUMN IF NOT EXISTS "payload_hash" varchar(64),
  ADD COLUMN IF NOT EXISTS "status" varchar(16) NOT NULL DEFAULT 'completed';

-- Rows written by the previous event-id-only implementation represent work
-- that was already accepted but have no payload to fingerprint. Bind them to
-- a deterministic legacy sentinel so a replay fails closed as a conflict
-- rather than risking a second settlement.
UPDATE "processed_indexer_events"
SET "payload_hash" = encode(digest("event_id", 'sha256'), 'hex')
WHERE "payload_hash" IS NULL;

ALTER TABLE "processed_indexer_events"
  ALTER COLUMN "payload_hash" SET NOT NULL;

ALTER TABLE "processed_indexer_events"
  ADD CONSTRAINT "processed_indexer_events_status_check"
  CHECK ("status" IN ('processing', 'completed', 'failed'));

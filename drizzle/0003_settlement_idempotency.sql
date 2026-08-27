ALTER TABLE "processed_indexer_events"
  ADD COLUMN IF NOT EXISTS "payload_hash" varchar(64);
--> statement-breakpoint
ALTER TABLE "processed_indexer_events"
  ADD COLUMN IF NOT EXISTS "status" varchar(16) NOT NULL DEFAULT 'completed';
--> statement-breakpoint
-- Legacy rows have no payload available; the event id sentinel deliberately
-- causes replay attempts to fail closed until they are reconciled.
UPDATE "processed_indexer_events"
SET "payload_hash" = encode(digest("event_id", 'sha256'), 'hex')
WHERE "payload_hash" IS NULL;
--> statement-breakpoint
ALTER TABLE "processed_indexer_events"
  ALTER COLUMN "payload_hash" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "processed_indexer_events"
  ADD CONSTRAINT "processed_indexer_events_status_check"
  CHECK ("status" IN ('processing', 'completed', 'failed'));

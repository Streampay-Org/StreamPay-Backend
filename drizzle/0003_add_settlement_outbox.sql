CREATE TYPE "settlement_outbox_status" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'dead');

CREATE TABLE "settlement_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_key" varchar(255) NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "aggregate_id" varchar(255) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "settlement_outbox_status" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 8 NOT NULL,
  "available_at" timestamp DEFAULT now() NOT NULL,
  "lease_until" timestamp,
  "lease_token" varchar(100),
  "last_error" text,
  "processed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "settlement_outbox_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "settlement_outbox_max_attempts_positive" CHECK ("max_attempts" > 0)
);

CREATE UNIQUE INDEX "settlement_outbox_event_key_unique" ON "settlement_outbox" ("event_key");
CREATE INDEX "settlement_outbox_due_idx" ON "settlement_outbox" ("status", "available_at");
CREATE INDEX "settlement_outbox_aggregate_idx" ON "settlement_outbox" ("aggregate_id", "created_at");

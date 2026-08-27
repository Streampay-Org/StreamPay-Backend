CREATE TABLE IF NOT EXISTS "metering_event_checkpoints" (
  "event_id" varchar(255) PRIMARY KEY NOT NULL,
  "stream_id" varchar(255) NOT NULL,
  "sequence" integer NOT NULL,
  "received_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "metering_event_checkpoints_stream_sequence_unique"
    UNIQUE ("stream_id", "sequence")
);

-- Review requests — additive only, safe to run against a live database.
--
-- NOT a drizzle-kit migration on purpose. `drizzle-kit generate` diffs
-- schema.ts against the snapshots in drizzle/meta, and those snapshots have
-- drifted from what is actually in production (this project has been kept up
-- to date with `db:push`). Generating from that state produces a file that
-- tries to CREATE TABLE audit_log, providers and sms_consents — all of which
-- already exist — and it fails on the first statement.
--
-- So: hand-written, idempotent, and runnable straight in the Neon SQL editor.
-- Every statement is IF NOT EXISTS, so running it twice costs nothing.
--
-- Run this BEFORE deploying the code that uses it. Adding columns nothing
-- reads yet is invisible to the running app; deploying code that reads columns
-- which don't exist is a 500 on every settings page.

DO $$ BEGIN
  CREATE TYPE "public"."reminder_kind" AS ENUM (
    'other',
    'appointment_reminder',
    'recovery_lead',
    'recovery_no_show',
    'review_request'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "reminders"
  ADD COLUMN IF NOT EXISTS "kind" "reminder_kind" NOT NULL DEFAULT 'other';

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "review_requests_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "review_url" text;

-- Dedupe asks "has this appointment already had a text of this kind?", which is
-- the shape this index serves.
CREATE INDEX IF NOT EXISTS "reminders_appointment_kind_idx"
  ON "reminders" ("appointment_id", "kind");

-- A review run logged as "outbound_recovery" is a run nobody can find later.
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it,
-- which is fine: this file runs before the code that writes the value.
ALTER TYPE "public"."agent_run_kind" ADD VALUE IF NOT EXISTS 'review_request';

-- Recall — "time for your next visit". Additive only; safe on a live database.
-- Same reasoning as 0001: hand-written and idempotent because the drizzle
-- snapshots have drifted from production. Run this BEFORE deploying the code.

ALTER TYPE "public"."reminder_kind" ADD VALUE IF NOT EXISTS 'recall';
ALTER TYPE "public"."agent_run_kind" ADD VALUE IF NOT EXISTS 'recall';

-- Null means "not a repeat service" — a consultation, a one-off repair. Those
-- must never generate a recall text, so null is the correct default and NOT a
-- placeholder for "we haven't decided yet".
ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "recall_interval_days" integer;

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "recall_enabled" boolean NOT NULL DEFAULT false;

-- Recall asks "when did this phone number last visit for this service?", which
-- reads appointments by client and customer phone.
CREATE INDEX IF NOT EXISTS "appointments_client_phone_idx"
  ON "appointments" ("client_id", "customer_phone");

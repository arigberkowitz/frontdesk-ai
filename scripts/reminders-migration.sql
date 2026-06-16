-- Idempotent version of drizzle/0004_reminders_and_human_touch.sql.
-- Safe to paste into the Neon SQL console and run more than once.

DO $$ BEGIN
  CREATE TYPE "reminder_channel" AS ENUM ('call', 'sms');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "reminder_status" AS ENUM ('queued', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "appointment_id" uuid REFERENCES "appointments"("id") ON DELETE SET NULL,
  "channel" "reminder_channel" NOT NULL,
  "status" "reminder_status" NOT NULL DEFAULT 'queued',
  "sent_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "reminders_client_id_idx" ON "reminders" ("client_id");
CREATE INDEX IF NOT EXISTS "reminders_appointment_id_idx" ON "reminders" ("appointment_id");

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "human_handoff_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "human_hours_note" text;

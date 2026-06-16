-- Idempotent version of drizzle/0006_lead_qualification_and_followup.sql.
-- Safe to paste into the Neon SQL console and run more than once.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "service" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "urgency" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "budget" text;

ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "lead_id" uuid;

DO $$ BEGIN
  ALTER TABLE "reminders"
    ADD CONSTRAINT "reminders_lead_id_leads_id_fk"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "reminders_lead_id_idx" ON "reminders" ("lead_id");

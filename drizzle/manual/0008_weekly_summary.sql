-- Weekly summary email — owner opt-out + a once-per-week send ledger.
-- Additive only, idempotent, safe on a live database. Hand-written for the
-- same reason as 0001–0007 (drizzle/meta snapshots have drifted from prod).
--
-- Run this BEFORE deploying the code that uses it: the Monday cron and the
-- Settings page read clients.weekly_summary_enabled, and the cron claims each
-- week in weekly_summary_sends before sending.

-- 1) Opt-out. Defaults to on, matching today's behavior (every live/trial
--    business with an owner email already gets the Monday report).
ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "weekly_summary_enabled" boolean DEFAULT true NOT NULL;

-- 2) One row per business per ISO week (e.g. '2026-W40'). The unique index is
--    the dedupe: a cron retry, a manual curl, or two overlapping runs can't
--    email the same business twice in one week.
CREATE TABLE IF NOT EXISTS "weekly_summary_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "week_key" text NOT NULL,
  "recipient" text NOT NULL,
  -- 'sending' (claimed), 'sent', 'skipped' (email provider not configured) or
  -- 'failed'. A later run the same week may retry only skipped/failed rows.
  "status" text NOT NULL DEFAULT 'sending',
  "stats" jsonb,
  "error" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "weekly_summary_sends"
    ADD CONSTRAINT "weekly_summary_sends_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "weekly_summary_sends_client_week_idx"
  ON "weekly_summary_sends" USING btree ("client_id", "week_key");

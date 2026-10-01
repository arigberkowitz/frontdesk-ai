-- AI text replies — per-business switch (OFF by default), the owner-reply
-- pause window, and per-conversation AI state. Additive only, idempotent, safe
-- on a live database. Hand-written for the same reason as 0001–0009
-- (drizzle/meta snapshots have drifted from prod).
--
-- NUMBERING: 0010 was free on main when this was written. Other branches in
-- flight may also want 0010 — renumber at merge time; nothing depends on the
-- number itself.
--
-- Run this BEFORE deploying the code that uses it: the Twilio webhook reads
-- clients.ai_text_replies_enabled on every inbound text.

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "ai_text_replies_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "ai_text_pause_hours" integer DEFAULT 12 NOT NULL;

CREATE TABLE IF NOT EXISTS "sms_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "customer_phone" text NOT NULL,
  "ai_paused" boolean DEFAULT false NOT NULL,
  "ai_paused_reason" text,
  "ai_paused_at" timestamp with time zone,
  "ai_resumed_at" timestamp with time zone,
  "ai_busy_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "sms_threads"
    ADD CONSTRAINT "sms_threads_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "sms_threads_client_phone_idx"
  ON "sms_threads" USING btree ("client_id", "customer_phone");

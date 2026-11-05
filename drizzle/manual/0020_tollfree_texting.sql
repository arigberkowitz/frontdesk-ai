-- Per-business toll-free texting numbers + Toll-Free Verification status.
--
-- Additive only, idempotent (safe to run twice), safe on a live database.
-- A new table, so deploying the code first doesn't break anything: every read
-- of it is behind TOLLFREE_SMS_ENABLED (default off).
--
-- DO NOT RUN ON PRODUCTION WITHOUT ARI'S APPROVAL.

CREATE TABLE IF NOT EXISTS "client_tollfree" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "status" text DEFAULT 'needs_number' NOT NULL,
  "phone_number" text,
  "phone_number_sid" text,
  "verification_sid" text,
  "twilio_status" text,
  "details" jsonb,
  "rejection_reason" text,
  "edit_allowed" boolean,
  "last_error" text,
  "submitted_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "checked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "client_tollfree"
    ADD CONSTRAINT "client_tollfree_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "client_tollfree_client_id_idx" ON "client_tollfree" ("client_id");
CREATE INDEX IF NOT EXISTS "client_tollfree_verification_sid_idx" ON "client_tollfree" ("verification_sid");

-- Owner texting controls: on/off switch and quiet hours (hours 0–23, local to
-- clients.timezone; start > end means the window crosses midnight). No row =
-- texting on, quiet 21:00–08:00. Only read when OWNER_TEXTING_CONTROLS=on.
CREATE TABLE IF NOT EXISTS "client_texting_prefs" (
  "client_id" uuid PRIMARY KEY NOT NULL,
  "texting_enabled" boolean DEFAULT true NOT NULL,
  "quiet_start_hour" smallint DEFAULT 21 NOT NULL,
  "quiet_end_hour" smallint DEFAULT 8 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "client_texting_prefs"
    ADD CONSTRAINT "client_texting_prefs_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Automated customer texts held during quiet hours, sent when the window ends.
CREATE TABLE IF NOT EXISTS "sms_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "to_phone" text NOT NULL,
  "body" text NOT NULL,
  "log" jsonb NOT NULL,
  "send_after" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "result" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "sms_queue"
    ADD CONSTRAINT "sms_queue_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "sms_queue_due_idx" ON "sms_queue" ("status", "send_after");

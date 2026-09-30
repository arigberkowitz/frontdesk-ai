-- Per-business texting numbers.
--
--  1. clients.sms_number — a business's OWN Twilio number (E.164). Null for
--     everyone until an operator pastes one in, so nothing changes on its own.
--  2. client_sms_opt_outs — STOP sent to one business's own number. The
--     existing sms_opt_outs table is untouched and keeps meaning "STOP to the
--     shared number", which still blocks every business.
--
-- Additive only, idempotent (safe to run twice), safe on a live database.
-- Hand-written like 0001–0007 (drizzle/meta snapshots have drifted from prod).
--
-- RUN THIS BEFORE DEPLOYING THE CODE THAT USES IT. The app reads every
-- clients column, so deploying first would break pages that load a client.

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "sms_number" text;

-- One live business per texting number, or inbound routing would be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "clients_sms_number_idx"
  ON "clients" ("sms_number")
  WHERE "sms_number" IS NOT NULL AND "deleted_at" IS NULL;

CREATE TABLE IF NOT EXISTS "client_sms_opt_outs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "phone" text NOT NULL,
  "business_phone" text,
  "keyword" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "client_sms_opt_outs"
    ADD CONSTRAINT "client_sms_opt_outs_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "client_sms_opt_outs_phone_client_idx"
  ON "client_sms_opt_outs" ("phone", "client_id");

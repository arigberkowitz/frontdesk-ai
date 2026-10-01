-- Smart rebooking — per-business switch (OFF by default) and the offers table.
-- Additive only, idempotent, safe on a live database. Hand-written like 0001–0009.
--
-- NUMBERING: 0013 assumes 0010 (AI text replies), 0011 (missed-call
-- callbacks) and 0012 (multilingual answering, #22) land first; renumber
-- at merge time — nothing depends on the number.
--
-- Run BEFORE deploying the code: the Hours page and the Twilio webhook read
-- clients.smart_rebooking_enabled.

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "smart_rebooking_enabled" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "rebook_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "appointment_id" uuid NOT NULL,
  "customer_phone" text NOT NULL,
  "slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text NOT NULL,
  "skip_reason" text,
  "new_appointment_id" uuid,
  "sent_at" timestamp with time zone,
  "responded_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "rebook_offers"
    ADD CONSTRAINT "rebook_offers_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rebook_offers"
    ADD CONSTRAINT "rebook_offers_appointment_id_appointments_id_fk"
    FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rebook_offers"
    ADD CONSTRAINT "rebook_offers_new_appointment_id_appointments_id_fk"
    FOREIGN KEY ("new_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "rebook_offers_client_phone_idx"
  ON "rebook_offers" USING btree ("client_id", "customer_phone", "status");
CREATE INDEX IF NOT EXISTS "rebook_offers_appointment_idx"
  ON "rebook_offers" USING btree ("appointment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "rebook_offers_one_live_per_appt_idx"
  ON "rebook_offers" USING btree ("appointment_id") WHERE "status" = 'sent';

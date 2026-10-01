-- Customer language (multilingual answering).
--
--  customer_languages: the language a customer spoke with the AI, per business
--  and phone number, so confirmation/reminder texts can be sent in it.
--
-- Additive only, idempotent (safe to run twice), safe on a live database.
-- Hand-written like 0001–0009 (drizzle/meta snapshots have drifted from prod).
--
-- Numbered 0011 because the AI text replies PR uses 0010. If that one merges
-- later or is renumbered, the order between them doesn't matter: they touch
-- different tables.
--
-- Run before (or after) deploying: the code reads/writes this table
-- fail-soft, so if the code goes first, texts simply stay in English until it
-- exists. No existing table or column is changed.

CREATE TABLE IF NOT EXISTS "customer_languages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "phone" text NOT NULL,
  "language" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "customer_languages"
    ADD CONSTRAINT "customer_languages_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "customer_languages_client_phone_idx"
  ON "customer_languages" ("client_id", "phone");

-- Missed/dropped-call callbacks — two per-business switches (both OFF by
-- default) and a one-row-per-call ledger. Additive only, idempotent, safe on a
-- live database. Hand-written like 0001–0009.
--
-- NUMBERING: 0011 assumes the AI text replies branch takes 0010. Other
-- branches in flight may also use 0010+; renumber at merge time — nothing
-- depends on the number.
--
-- Run BEFORE deploying the code: the Retell webhook reads
-- clients.missed_call_texts_enabled on every analyzed call.

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "missed_call_texts_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "missed_call_ai_callbacks_enabled" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "call_callbacks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "call_id" uuid NOT NULL,
  "customer_phone" text NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "skip_reason" text,
  "channel" text,
  "send_after" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "retell_call_id" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "call_callbacks"
    ADD CONSTRAINT "call_callbacks_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "call_callbacks"
    ADD CONSTRAINT "call_callbacks_call_id_calls_id_fk"
    FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "call_callbacks_call_id_idx"
  ON "call_callbacks" USING btree ("call_id");
CREATE INDEX IF NOT EXISTS "call_callbacks_client_phone_idx"
  ON "call_callbacks" USING btree ("client_id", "customer_phone", "created_at");
CREATE INDEX IF NOT EXISTS "call_callbacks_status_send_after_idx"
  ON "call_callbacks" USING btree ("status", "send_after");

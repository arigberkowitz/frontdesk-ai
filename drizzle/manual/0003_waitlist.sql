-- Waitlist — capture people who wanted a time we couldn't give them, and text
-- them when a cancellation frees it. Additive only; safe on a live database.
-- Hand-written and idempotent for the same reason as 0001 and 0002.

ALTER TYPE "public"."reminder_kind" ADD VALUE IF NOT EXISTS 'waitlist_offer';

DO $$ BEGIN
  CREATE TYPE "public"."waitlist_status" AS ENUM (
    'waiting', 'notified', 'booked', 'expired', 'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "waitlist_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "call_id" uuid,
  "service_id" uuid,
  "customer_name" text,
  "customer_phone" text NOT NULL,
  "earliest_at" timestamp with time zone NOT NULL,
  "latest_at" timestamp with time zone NOT NULL,
  "note" text,
  "status" "waitlist_status" DEFAULT 'waiting' NOT NULL,
  "notified_at" timestamp with time zone,
  "notify_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

DO $$ BEGIN
  ALTER TABLE "waitlist_entries"
    ADD CONSTRAINT "waitlist_entries_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "waitlist_entries"
    ADD CONSTRAINT "waitlist_entries_call_id_calls_id_fk"
    FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "waitlist_entries"
    ADD CONSTRAINT "waitlist_entries_service_id_services_id_fk"
    FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "waitlist_client_status_idx"
  ON "waitlist_entries" ("client_id", "status");
CREATE INDEX IF NOT EXISTS "waitlist_client_window_idx"
  ON "waitlist_entries" ("client_id", "earliest_at", "latest_at");

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "waitlist_enabled" boolean NOT NULL DEFAULT false;

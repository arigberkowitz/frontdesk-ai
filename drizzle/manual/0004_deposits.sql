-- Deposits — ask for money up front on the bookings where a no-show hurts.
-- Additive only, idempotent, safe on a live database. Run before deploying.

ALTER TYPE "public"."reminder_kind" ADD VALUE IF NOT EXISTS 'deposit_request';

DO $$ BEGIN
  CREATE TYPE "public"."deposit_status" AS ENUM (
    'not_required', 'requested', 'paid', 'waived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "deposit_cents" integer;

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "deposit_status" "deposit_status" NOT NULL DEFAULT 'not_required';
ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "deposit_amount_cents" integer;
ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "deposit_marked_at" timestamp with time zone;

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "deposits_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "deposit_link_url" text;

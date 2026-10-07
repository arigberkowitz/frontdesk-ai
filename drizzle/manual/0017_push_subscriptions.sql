-- Web push — owner phone notifications for new customer texts and new bookings.
-- Additive only, idempotent, safe on a live database. Hand-written like 0001–0013.
--
-- NUMBERING: 0013 is the latest on main. 0017 skips 0016 (calendar busy
-- calendars, PR #26) and leaves 0014/0015 for other in-flight work. Nothing
-- depends on the number; renumber at merge time if needed.
--
-- Run BEFORE deploying the code. Without the table the app still works: the
-- opt-in card fails soft and sends are skipped (logged), but nobody can turn
-- notifications on. Push also stays off until VAPID_* are set (LAUNCH.md).

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "notify_texts" boolean DEFAULT true NOT NULL,
  "notify_bookings" boolean DEFAULT true NOT NULL,
  "last_success_at" timestamp with time zone,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_idx"
  ON "push_subscriptions" USING btree ("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_client_idx"
  ON "push_subscriptions" USING btree ("client_id");
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx"
  ON "push_subscriptions" USING btree ("user_id");

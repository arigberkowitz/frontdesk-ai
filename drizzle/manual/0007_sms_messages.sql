-- SMS inbox — store every text between a business and its customers (both
-- directions) so owners can read replies in the portal's Messages page.
-- Additive only, idempotent, safe on a live database. Hand-written for the
-- same reason as 0001–0006 (drizzle/meta snapshots have drifted from prod).
--
-- Run this BEFORE deploying the code that uses it. Until it lands, the webhook
-- and the senders keep working (storing a message is best-effort and never
-- blocks STOP handling or a send), but the Messages page itself would error.

DO $$ BEGIN
  CREATE TYPE "public"."sms_direction" AS ENUM ('inbound', 'outbound');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."sms_message_status" AS ENUM ('received', 'sent', 'delivered', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "sms_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "direction" "sms_direction" NOT NULL,
  "customer_phone" text NOT NULL,
  "business_phone" text,
  "body" text NOT NULL,
  "status" "sms_message_status" NOT NULL,
  "kind" text,
  "provider_sid" text,
  "appointment_id" uuid,
  "lead_id" uuid,
  "error" text,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "sms_messages"
    ADD CONSTRAINT "sms_messages_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sms_messages"
    ADD CONSTRAINT "sms_messages_appointment_id_appointments_id_fk"
    FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sms_messages"
    ADD CONSTRAINT "sms_messages_lead_id_leads_id_fk"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Idempotency: one row per Twilio MessageSid (NULLs allowed for failed sends).
CREATE UNIQUE INDEX IF NOT EXISTS "sms_messages_provider_sid_idx"
  ON "sms_messages" ("provider_sid");
CREATE INDEX IF NOT EXISTS "sms_messages_client_phone_created_idx"
  ON "sms_messages" ("client_id", "customer_phone", "created_at");
CREATE INDEX IF NOT EXISTS "sms_messages_client_created_idx"
  ON "sms_messages" ("client_id", "created_at");
CREATE INDEX IF NOT EXISTS "sms_messages_customer_phone_idx"
  ON "sms_messages" ("customer_phone");

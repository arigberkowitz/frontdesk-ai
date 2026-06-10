CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'confirmed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."call_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('booked', 'lead', 'faq_answered', 'escalated', 'spam', 'missed', 'other');--> statement-breakpoint
CREATE TYPE "public"."call_sentiment" AS ENUM('positive', 'neutral', 'negative', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('draft', 'trial', 'live', 'paused', 'churned');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source" AS ENUM('scraped', 'manual');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('booking', 'lead', 'digest_daily', 'digest_weekly', 'system');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'paused', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('operator', 'client_viewer');--> statement-breakpoint
CREATE TYPE "public"."webhook_source" AS ENUM('retell', 'stripe', 'cal');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('received', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"prompt_snapshot" text NOT NULL,
	"knowledge_snapshot" jsonb,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"call_id" uuid,
	"customer_name" text,
	"customer_phone" text,
	"service_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"external_booking_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "business_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"open_time" text,
	"close_time" text,
	"is_closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"retell_call_id" text,
	"direction" "call_direction" DEFAULT 'inbound' NOT NULL,
	"from_number" text,
	"to_number" text,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"duration_sec" integer,
	"recording_url" text,
	"transcript" text,
	"summary" text,
	"sentiment" "call_sentiment",
	"outcome" "call_outcome",
	"is_after_hours" boolean DEFAULT false NOT NULL,
	"confidence_flag" boolean DEFAULT false NOT NULL,
	"retell_cost_cents" integer,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"industry" text,
	"address" text,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"status" "client_status" DEFAULT 'draft' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"retell_agent_id" text,
	"retell_llm_id" text,
	"retell_phone_number" text,
	"forwarding_number" text,
	"escalation_number" text,
	"voice_id" text,
	"greeting" text,
	"recording_disclosure_enabled" boolean DEFAULT true NOT NULL,
	"recording_disclosure_line" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"source" "knowledge_source" DEFAULT 'manual' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"call_id" uuid,
	"name" text,
	"phone" text,
	"reason" text,
	"message" text,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"recipient" text NOT NULL,
	"payload" jsonb,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_min" integer DEFAULT 30 NOT NULL,
	"price_cents" integer,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"plan" text,
	"monthly_price_cents" integer,
	"setup_fee_cents" integer,
	"status" "subscription_status",
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"clerk_user_id" text,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'operator' NOT NULL,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "webhook_source" NOT NULL,
	"external_id" text,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"status" "webhook_status" DEFAULT 'received' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_versions_client_id_idx" ON "agent_versions" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_client_version_idx" ON "agent_versions" USING btree ("client_id","version");--> statement-breakpoint
CREATE INDEX "appointments_client_id_start_at_idx" ON "appointments" USING btree ("client_id","start_at");--> statement-breakpoint
CREATE INDEX "appointments_call_id_idx" ON "appointments" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "business_hours_client_id_idx" ON "business_hours" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_hours_client_day_idx" ON "business_hours" USING btree ("client_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_retell_call_id_idx" ON "calls" USING btree ("retell_call_id");--> statement-breakpoint
CREATE INDEX "calls_client_id_start_at_idx" ON "calls" USING btree ("client_id","start_at");--> statement-breakpoint
CREATE INDEX "calls_outcome_idx" ON "calls" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "clients_org_id_idx" ON "clients" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "clients_status_idx" ON "clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "knowledge_items_client_id_idx" ON "knowledge_items" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "leads_client_id_idx" ON "leads" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "notifications_client_id_idx" ON "notifications" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "services_client_id_idx" ON "services" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_client_id_idx" ON "subscriptions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "subscriptions_stripe_customer_idx" ON "subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_clerk_user_id_idx" ON "users" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "users_org_id_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "users_client_id_idx" ON "users" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_source_external_idx" ON "webhook_events" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status");
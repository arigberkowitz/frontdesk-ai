ALTER TABLE "clients" ADD COLUMN "owner_email" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "agent_guidance" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "booking_instructions" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "calendar_provider" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "calendar_account" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "calendar_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "calendar_secret" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "calendar_connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "domain" text;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_domain_idx" ON "organizations" USING btree ("domain");
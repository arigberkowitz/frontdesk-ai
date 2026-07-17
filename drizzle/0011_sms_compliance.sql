ALTER TYPE "public"."webhook_source" ADD VALUE 'twilio';--> statement-breakpoint
CREATE TABLE "sms_opt_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"keyword" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_reply_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_opt_outs_phone_idx" ON "sms_opt_outs" USING btree ("phone");
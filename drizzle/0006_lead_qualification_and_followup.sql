ALTER TABLE "leads" ADD COLUMN "service" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "urgency" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "budget" text;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_lead_id_idx" ON "reminders" USING btree ("lead_id");
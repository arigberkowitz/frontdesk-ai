CREATE TYPE "public"."agent_run_kind" AS ENUM('nightly_improve', 'qa_review', 'post_call');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."grade_status" AS ENUM('open', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('proposed', 'applied', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."suggestion_type" AS ENUM('knowledge', 'guidance');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "agent_run_kind" NOT NULL,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"run_id" uuid,
	"type" "suggestion_type" NOT NULL,
	"question" text,
	"answer" text,
	"guidance" text,
	"rationale" text NOT NULL,
	"evidence" jsonb,
	"status" "suggestion_status" DEFAULT 'proposed' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"run_id" uuid,
	"score" integer NOT NULL,
	"flags" jsonb,
	"compliance_risk" boolean DEFAULT false NOT NULL,
	"coaching_note" text,
	"status" "grade_status" DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"intent" text,
	"entities" jsonb,
	"is_spam" boolean DEFAULT false NOT NULL,
	"follow_up_channel" text,
	"follow_up_subject" text,
	"follow_up_draft" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_grades" ADD CONSTRAINT "call_grades_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_grades" ADD CONSTRAINT "call_grades_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_grades" ADD CONSTRAINT "call_grades_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_grades" ADD CONSTRAINT "call_grades_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_insights" ADD CONSTRAINT "call_insights_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_insights" ADD CONSTRAINT "call_insights_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_client_kind_idx" ON "agent_runs" USING btree ("client_id","kind");--> statement-breakpoint
CREATE INDEX "agent_suggestions_client_status_idx" ON "agent_suggestions" USING btree ("client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "call_grades_call_id_idx" ON "call_grades" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "call_grades_client_status_idx" ON "call_grades" USING btree ("client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "call_insights_call_id_idx" ON "call_insights" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "call_insights_client_id_idx" ON "call_insights" USING btree ("client_id");
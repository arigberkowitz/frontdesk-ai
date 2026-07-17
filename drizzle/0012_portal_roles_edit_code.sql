ALTER TYPE "public"."user_role" ADD VALUE 'client_admin' BEFORE 'client_viewer';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "edit_code_hash" text;
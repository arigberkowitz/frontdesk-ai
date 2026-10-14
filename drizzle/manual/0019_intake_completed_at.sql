-- Intake links stop working once the intake is completed. Additive, nullable,
-- idempotent, safe live. Run BEFORE deploying the code that reads/writes it.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "intake_completed_at" timestamp with time zone;

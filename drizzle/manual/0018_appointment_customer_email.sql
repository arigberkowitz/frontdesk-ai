-- Customer email on appointments, so a web-chat visitor can get their cancel
-- code by email instead of text. Additive, nullable, idempotent, safe live.
-- Run BEFORE deploying the code that reads/writes it.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "customer_email" text;

-- Idempotent version of drizzle/0005_client_languages.sql.
-- Safe to paste into the Neon SQL console and run more than once.

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "languages" text NOT NULL DEFAULT 'en';

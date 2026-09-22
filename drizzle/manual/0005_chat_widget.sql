-- Website chat widget — additive only, idempotent, safe on a live database.
-- Hand-written for the same reason as 0001–0004. Run BEFORE deploying.

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "chat_widget_enabled" boolean NOT NULL DEFAULT false;

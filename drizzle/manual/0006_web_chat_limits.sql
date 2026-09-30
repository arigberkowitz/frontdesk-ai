-- Durable caps for the public website chat — additive only, idempotent, safe
-- on a live database. Hand-written for the same reason as 0001–0005. Run
-- before (or right after) deploying; until it lands, the caps fall back to
-- in-memory counting (src/lib/data/chat-limits.ts).

ALTER TYPE "public"."agent_run_kind" ADD VALUE IF NOT EXISTS 'web_chat_turn';
ALTER TYPE "public"."agent_run_kind" ADD VALUE IF NOT EXISTS 'web_chat_sms';

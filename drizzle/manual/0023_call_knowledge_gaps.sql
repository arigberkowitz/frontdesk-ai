-- Questions callers asked that the AI couldn't answer ("knowledge gaps").
--
--  call_knowledge_gaps: one row per call the post-call extraction checked.
--  `questions` holds short, generalized questions the AI had no answer for
--  (empty array = checked, nothing missed). The portal rolls these up into
--  "calls with a question it couldn't answer: X of Y in the last 30 days".
--
-- Additive only, idempotent (safe to run twice), safe on a live database.
-- No existing table or column is changed.
--
-- Run before (or after) deploying: the code reads/writes this table
-- fail-soft. If the code goes first, extraction keeps working and the portal
-- card simply stays hidden until the table exists.

CREATE TABLE IF NOT EXISTS "call_knowledge_gaps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "call_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "call_knowledge_gaps"
    ADD CONSTRAINT "call_knowledge_gaps_call_id_calls_id_fk"
    FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "call_knowledge_gaps"
    ADD CONSTRAINT "call_knowledge_gaps_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "call_knowledge_gaps_call_id_idx"
  ON "call_knowledge_gaps" ("call_id");

CREATE INDEX IF NOT EXISTS "call_knowledge_gaps_client_created_idx"
  ON "call_knowledge_gaps" ("client_id", "created_at");

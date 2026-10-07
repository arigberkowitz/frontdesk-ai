-- Calendar sync gaps — which extra calendars count as busy.
-- Additive only, idempotent, safe on a live database. Hand-written like 0001–0013.
--
-- NUMBERING: 0016 on purpose. 0014 and 0015 are left for the other portal PRs
-- being built in parallel; nothing depends on the number, renumber at merge
-- time if you like.
--
-- Run BEFORE deploying the code: every clients query selects this column.
--
-- calendar_busy_ids: jsonb array of calendar ids (Google calendar ids typed by
-- the owner, or Microsoft Graph calendar ids picked from the Outlook list)
-- whose events also block booking. NULL = only the booking calendar, which is
-- exactly today's behaviour.

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "calendar_busy_ids" jsonb;

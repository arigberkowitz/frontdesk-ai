-- Meeting links: where a service happens (in person / phone / video), which
-- video provider, a per-business Zoom connection, and the Zoom meeting id on
-- each appointment. All additive, defaulted or nullable, idempotent, safe live.
-- Run BEFORE deploying the code that reads/writes these columns (drizzle
-- selects them by name, so the deploy fails on services/clients/appointments
-- until they exist).
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "location_type" text DEFAULT 'in_person' NOT NULL;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "video_provider" text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "zoom_secret" text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "zoom_account" text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "zoom_connected_at" timestamp with time zone;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "how_to_find_us" text;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "zoom_meeting_id" text;

-- Services that were already "can be done by video" keep behaving the same:
-- video, on the calendar's own link (Meet / Teams). Safe to re-run: only rows
-- still on the default are touched.
UPDATE "services"
   SET "location_type" = 'video', "video_provider" = 'meet'
 WHERE "virtual_ok" = true AND "location_type" = 'in_person';

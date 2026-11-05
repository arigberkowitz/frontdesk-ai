-- Trades essentials: service address on bookings and messages, price ranges /
-- "starts at" on services, and a trip (service-call) fee. All additive,
-- nullable or defaulted, idempotent, safe live. Run BEFORE deploying the code
-- that reads/writes these columns (drizzle selects them by name).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "service_address" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "service_address" text;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "price_max_cents" integer;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "price_from" boolean DEFAULT false NOT NULL;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "trip_fee_cents" integer;

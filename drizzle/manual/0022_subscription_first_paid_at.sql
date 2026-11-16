-- Record the first time Stripe collected a real payment (amount_paid > 0)
-- for a business. A 100%-off promo code can leave subscriptions.status =
-- 'active' with first_paid_at still null; those accounts must not get a
-- toll-free texting number. Idempotent, additive, nullable, safe live.
-- Apply before (or with) deploying the code that reads this column.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "first_paid_at" timestamp with time zone;

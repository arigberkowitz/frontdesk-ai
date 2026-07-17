# Launch runbook — first customer

Everything left between here and a paying customer, in order. Code is done;
these are config, registration, and verification steps. The live launch-check
is at `/settings` (every row should read "Connected").

## 1. Free, do now

### Rotate the database password (leaked during setup)
1. Neon Console → frontdesk-db → Connect → **Reset password**.
2. Copy the new connection string (pooled version this time is fine for the app).
3. Vercel → Project → Settings → Environment Variables → update `DATABASE_URL` → redeploy.
4. Update `.env.local` if you develop locally against Neon.

### Sentry (free tier)
1. sentry.io → create org → new project → **Next.js**.
2. Copy the DSN. In Vercel env vars set BOTH:
   - `SENTRY_DSN` = the DSN
   - `NEXT_PUBLIC_SENTRY_DSN` = the same DSN
3. Redeploy. `/settings` row flips to Connected. Errors from webhooks and
   agent crons now alert you.

### Legal
1. Replace the bracketed placeholders in
   `src/app/(legal)/terms/page.tsx` and `src/app/(legal)/privacy/page.tsx`:
   entity name, governing state, support email.
2. Clerk Dashboard → Customization → **Legal** → enable the terms/privacy
   checkbox and point it at `/terms` and `/privacy`.
3. Have a lawyer skim both pages before charging anyone.

### Dress rehearsal (the critical path, ~pennies of usage)
1. Sign up fresh (or use an existing test client) in production.
2. Onboard a real business website → verify services/hours/FAQ drafted,
   greeting + guidance auto-filled.
3. Provision the agent, call the number:
   - it answers with the disclosure + greeting
   - book an appointment → hits the calendar + dashboard
   - call again, leave a message → lead captured, owner email arrives
4. Check the call detail page: transcript, summary, insight chips
   (intent / wants / when) appear within a minute of `call_analyzed`.
5. Next morning, check:
   - Dashboard → "While you were out" (QA graded, improvements proposed)
   - `/review` → flagged calls, if any
   - Portal → "Your AI learned N things" + the owner email about it

## 2. Costs money, do when ready

### Twilio (SMS alerts + recovery texts) — START THE REGISTRATION EARLY
1. Buy a number (~$1/mo) and set in Vercel:
   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
2. **A2P 10DLC registration** (required for US business SMS — texts won't
   deliver reliably without it): Twilio Console → Messaging → Regulatory
   Compliance → register brand + campaign. Takes days–weeks; start now even
   if you flip the env vars later.
3. Configure the number's inbound webhook: Twilio Console → your number →
   Messaging → "A message comes in" → POST
   `https://<domain>/api/webhooks/twilio`. This powers STOP/HELP compliance
   and "lead texted back" handling (pauses recovery, emails the owner).
4. Until then, SMS features log as "demo" sends — email alerts already work.

### Stripe (billing) — do this LAST
Not needed for customer #1: run a free pilot or invoice manually
(`trial` status exists for exactly this). When someone wants to pay:
1. Live keys → `STRIPE_SECRET_KEY`; webhook endpoint
   `https://<domain>/api/webhooks/stripe` → `STRIPE_WEBHOOK_SECRET`.
2. Confirm plan prices in `src/config/plans.ts` match your Stripe products.

## 3. Cron schedule (already registered in vercel.json)

| Job | UTC | What it does |
| --- | --- | --- |
| `/api/cron/qa-review` | 08:30 | Grades yesterday's calls, fills `/review` |
| `/api/cron/nightly-improve` | 09:00 | Drafts knowledge/guidance suggestions |
| `/api/cron/digest` | 14:00 | Owner daily digests |
| `/api/cron/outbound-recovery` | 17:00 | Texts cold leads/no-shows (opt-in clients only) |

All require `CRON_SECRET` (already set). Manual trigger for testing:
`curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/qa-review`

## 4. Selling

- `/growth` — paste 5 prospect websites → fit scores + outreach drafts.
- `sales/` — one-page pitch PDF + outreach scripts.
- The demo: onboard the prospect's OWN website live during the pitch, then
  call the number in front of them. Nothing sells it better.

## Notes / known limits

- DB schema syncs with `npm run db:push` (NOT `db:migrate` — the migration
  journal predates the push workflow and is out of sync). Run it after any
  schema change, including the `copilot_chat` enum value (migration 0010).
- Copilot rate limiting is durable (Postgres-backed via `agent_runs`,
  60/day + 3s gap per client) and falls back to in-memory if the enum
  migration hasn't landed yet.
- Cron loops run 3 clients concurrently (QA grades 4 calls concurrently
  within a client), respect a time budget, and are RESUMABLE: clients served
  in the last 20h are skipped, so short function budgets (Vercel Hobby's 60s)
  converge if the cron fires again — trigger manually with the curl above.
- `maxDuration: 300` needs Vercel Pro for a single-shot nightly run at scale;
  on Hobby the resumability makes it converge across triggers instead.

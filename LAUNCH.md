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

### Team invites (Clerk, free)
Settings → Team lets an owner invite staff/owners by email. Clerk sends the email.
1. Vercel env: `CLERK_SECRET_KEY` must be set (it already is if sign-in works). Without
   it the invite form says invites aren't switched on.
2. Clerk Dashboard → **Restrictions**: invitations work in both Public and
   Restricted sign-up modes. If you run an email allowlist, test one invite first.
3. Clerk Dashboard → **Paths / Allowed redirect URLs**: make sure `APP_URL/portal`
   is allowed (the invite link returns there).
4. Use the PRODUCTION Clerk instance's key in production; invites made on the dev
   instance don't carry over.

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
| `/api/cron/weekly-report` | Mon 15:00 | Weekly summary email (+ weekly SMS digest) |
| `/api/cron/daily-briefing` | daily 10:00–17:00 (8 entries) | Morning briefing email, 7–10am in each opted-in business's zone |
| `/api/cron/outbound-recovery` | 17:00 | Texts cold leads/no-shows (opt-in clients only) |
| `/api/cron/missed-call-callbacks` | 16:45 | Sends missed-call text-backs held overnight (opt-in clients only) |

All require `CRON_SECRET` (already set). Manual trigger for testing:
`curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/qa-review`

## 4. Selling

- `/growth` — paste 5 prospect websites → fit scores + outreach drafts.
- `sales/` — one-page pitch PDF + outreach scripts.
- The demo: onboard the prospect's OWN website live during the pitch, then
  call the number in front of them. Nothing sells it better.

## Notes / known limits

- **Missed-call text-back** (Settings → Follow-ups, off by default): run
  `drizzle/manual/0011_missed_call_callbacks.sql` before deploying. Only texts
  callers with a stored SMS consent (see DECISIONS.md — first-time callers
  usually have none). The AI phone-callback option stays inert until you set
  `MISSED_CALL_AI_CALLBACKS=on` in Vercel; leave it unset until you've decided
  you want robots dialing people back.

- **Smart rebooking** (Settings → Follow-ups, off by default): run
  `drizzle/manual/0013_smart_rebooking.sql` before deploying. Needs a connected
  calendar to find new times; sends only when the owner confirms on the Hours
  page.

- **Phone notifications (web push) + "Add to Home Screen"** (Settings → Alerts,
  owner opt-in per device). Run `drizzle/manual/0017_push_subscriptions.sql`
  before deploying. The home-screen install (manifest + icons) works with no
  setup; push stays hidden until all three VAPID vars are set:
  1. On your own machine (never in a shared chat or a commit):
     `npx web-push generate-vapid-keys` — prints a Public Key and a Private Key.
  2. Vercel → Project → Settings → Environment Variables (Production, and
     Preview if you want to test there):
     - `VAPID_PUBLIC_KEY` = the Public Key
     - `VAPID_PRIVATE_KEY` = the Private Key (mark it Sensitive)
     - `VAPID_SUBJECT` = `mailto:support@frontdeskai.company`
  3. Redeploy. Settings → Alerts now shows "Phone notifications".
  4. Test: on an iPhone, open the portal in Safari → Share → **Add to Home
     Screen**, open FrontDesk from the home screen (iOS only allows push for
     installed apps, iOS 16.4+), Settings → Alerts → Turn on → **Send a test**.
     Android/desktop Chrome work straight from the browser.
  Set the pair once: rotating it silently orphans every existing subscription
  (they fail with 403/410 and are deleted; owners have to turn it on again).
  Notifications show the customer's name or number but never the message text,
  so nothing private sits on a lock screen.

- **Calendar sync (Google / Outlook one-click).** No migration. Needs
  `CREDENTIALS_SECRET` (long random string; encrypts tokens). Each option stays
  hidden until its keys are set:
  - **Google:** Google Cloud Console → APIs & Services → enable **Google Calendar
    API** → OAuth consent screen (External; scopes `calendar.events`,
    `calendar.freebusy`, `openid`, `email`; add test users until verified) →
    Credentials → OAuth client ID (Web application) with redirect URI
    `https://<domain>/api/calendar/google/callback` → set `GOOGLE_CLIENT_ID`,
    `GOOGLE_CLIENT_SECRET`. Submit the app for verification before real customers
    (otherwise owners see the "unverified app" screen and there's a 100-user cap).
  - **Outlook / Microsoft 365:** Azure Portal → App registrations → New
    (supported accounts: "any org directory + personal Microsoft accounts"),
    Web redirect URI `https://<domain>/api/calendar/microsoft/callback` → API
    permissions: Microsoft Graph delegated `Calendars.ReadWrite`, `offline_access`,
    `openid`, `email` → Certificates & secrets → new client secret → set
    `MICROSOFT_CLIENT_ID` (Application ID), `MICROSOFT_CLIENT_SECRET`. Secrets expire
    (max 24 months) — calendar a rotation. Consider publisher verification.
  - Smoke test: connect in portal → Settings → Calendar, put a busy event on the
    calendar, call and ask for that exact time (should be refused), book a free
    time (event appears), cancel it (event disappears).

- **AI text replies — MIGRATION REQUIRED:** apply `drizzle/manual/0010_ai_text_replies.sql`
  (Neon SQL editor, idempotent) **before** the deploy (renumber if another branch merged a
  0010 first). No new env vars: uses `ANTHROPIC_API_KEY` (optional `CHAT_MODEL`),
  `AGENT_TOOLS_SECRET`, `APP_URL`, Twilio. Off for every business until the owner turns it on
  in Settings → Follow-ups. Smoke test on a test business with a calendar: turn it on, text
  the number "do you have anything Tuesday?", confirm an AI-badged reply; text "can I talk to
  a person" and confirm the thread pauses and the "Needs you:" email arrives; reply from
  Messages and confirm the AI stays quiet; press Resume AI.

- **Per-business texting numbers** (optional): apply
  `drizzle/manual/0009_client_sms_numbers.sql` (Neon SQL editor, idempotent)
  **before** deploying that code. No env vars. To give a business its own number:
  buy it in Twilio, add it to the A2P 10DLC campaign's Messaging Service, set its
  "A message comes in" webhook to POST `https://<domain>/api/webhooks/twilio`, then
  paste it on the client's Settings tab → "Texting number". Leave empty to revert.

- **After deploying the SMS replies inbox:** apply `drizzle/manual/0007_sms_messages.sql`
  (Neon SQL editor, idempotent) **before** the deploy. The Twilio number's "A message comes
  in" webhook must already POST to `/api/webhooks/twilio` (unchanged). Messages only
  appear for texts sent/received after the deploy.

- **Reply by text from Messages** needs no migration or env var (uses `sms_messages` from
  0007). Smoke test: text the Twilio number from your phone, open that conversation in
  portal → Messages, send a reply, and confirm it arrives prefixed with the business name.

- **Reply alerts** (customer text → email) need no migration or env var. They use the
  existing `RESEND_API_KEY` + alert roster and never text anyone. Smoke test: text the
  Twilio number twice within a minute; exactly one email should arrive, linking to that
  conversation in Messages.

- **Daily owner briefing** needs no migration and no new env vars (uses `RESEND_API_KEY`,
  `ANTHROPIC_API_KEY` — optional, falls back to a template — and `CRON_SECRET`). It's off for
  every business until the owner turns it on (Settings → Alerts → Morning briefing email).
  `vercel.json` adds eight daily entries for `/api/cron/daily-briefing` (Hobby allows only
  daily crons). Check it at `/portal/settings/daily-briefing` (preview only, sends nothing), or
  trigger a run with the curl above; a business only gets one per local day.

- **Call recaps** (message taken / call transferred → one alert per call) need no migration
  or env var. They use `RESEND_API_KEY`, the alert roster and, only where SMS alerts already
  applied, Twilio. The Retell agent must deliver `call_analyzed` to `/api/webhooks/retell`
  (it already does for extraction). Smoke test: call, ask the AI to take a message, hang up.
  Within about a minute you should get exactly one "<name> left a message" email, and no
  separate "New message" email.

- **Multilingual answering — MIGRATION:** apply `drizzle/manual/0012_customer_languages.sql`
  (Neon SQL editor, idempotent). The code is fail-soft without it (texts just stay English), so
  order doesn't matter, but run it to get Spanish texts. No env vars.
  - **After deploying, run Settings → Re-sync agents.** Bilingual businesses' Retell agents
    move from the deprecated `"multi"` (ten languages) to their exact locales plus the
    `eleven_flash_v2_5` voice model.
  - Smoke test: set Phone & AI → Languages to English + Spanish, then call and speak Spanish.
    The AI should switch, repeat the AI/recording notice in Spanish, and ask the texting
    question in Spanish. Book with "sí", and the confirmation text should arrive in Spanish.

- **Weekly summary email — MIGRATION REQUIRED:** apply `drizzle/manual/0008_weekly_summary.sql`
  (Neon SQL editor, idempotent) **before** the deploy. It adds `clients.weekly_summary_enabled`
  and the `weekly_summary_sends` dedupe table. It uses the existing Monday cron
  (`/api/cron/weekly-report`), `RESEND_API_KEY`/`RESEND_FROM` and `CRON_SECRET`, with no new
  env vars. To check it, open `/portal/settings/weekly-summary` (preview only, sends nothing).

- **After deploying the security-hardening change:** apply
  `drizzle/manual/0006_web_chat_limits.sql` (or `npm run db:push`), then run
  Settings → Re-sync agents so every Retell agent gets its per-client tool URL.
  Place one real test call (book + cancel) and check the logs for
  `agent-tools.auth.unsigned_rejected`. If Retell-signed calls are being
  rejected, set `AGENT_TOOLS_SIGNATURE_MODE=report` temporarily and investigate.

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

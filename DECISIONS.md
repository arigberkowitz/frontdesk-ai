# DECISIONS

Running log of choices and deviations (PRD §0). Newest first.

## Phase 3 — Analytics, ROI & client portal

### Metrics
- **SQL aggregates** in `src/lib/data/metrics.ts` (`count(*) filter (where …)`, `date_trunc`,
  `make_interval`), scoped by org/client and **verified against seeded data**. Per-client ROI
  (revenue captured = bookings × avg active service price; containment; answer rate; after-hours;
  sentiment; 14-day series) + portfolio rollup (calls/bookings today, after-hours/week, MRR, est.
  revenue, margin = MRR − Retell cost − per-client overhead).
- **Charts: Recharts 3.8** — `CallsChart` is a client component that imports only the metric *type*.

### CSV export
- `GET /api/clients/:id/export?type=calls|appointments|leads` — operator-auth'd via
  **`getCurrentDbUserSafe`** (non-redirecting; returns 401), then tenant-scoped. Pure `toCsv` util.

### Client portal (read-only)
- `/portal` (Overview ROI), `/portal/calls` (+ a **client-scoped** call detail), `/portal/appointments`
  — own layout + nav, guarded by `requireClientViewer`. A viewer sees only their own client
  (`getCallForClient` is client-scoped, never org-scoped — §12).
- **Account provisioning via Clerk publicMetadata**: `getCurrentDbUser` honors
  `{ role:'client_viewer', clientId }` on first login; the Settings → "Client portal" invite sends a
  Clerk invitation carrying that metadata. Needs a real `CLERK_SECRET_KEY` (keyless dev can't send
  invitations — the action says so).

### Digests
- `src/lib/digest.ts` + `GET /api/cron/digest?period=daily|weekly` (public route, **CRON_SECRET**
  bearer; disabled until set). Per active client: an owner **SMS** of the period summary, logged to
  `notifications`; clients with no activity are skipped. Owner *email* digests await an owner-email column.

## Phase 2 — Onboarding engine

### Scraping
- **cheerio + native `fetch`** (no headless browser). Homepage + up to 5 keyword-matched same-origin
  pages (services/about/contact/hours/pricing/faq/book/menu); boilerplate stripped; capped at 40K
  chars. **Discover links BEFORE stripping nav/header/footer** — those hold the navigation. (A test
  against real sites caught this ordering bug.) JS-rendered nav is a known gap → headless fallback later.

### Structuring (Claude)
- **Anthropic TS SDK with a forced tool call** (`tool_choice: {type:"tool"}`) into a strict
  `input_schema`, then **zod-validated defensively**. Per the `claude-api` skill — more portable than
  the newer `output_config.format`, and exactly the PRD's "strict JSON schema instruction".
- **Model `claude-opus-4-8`** (Anthropic's recommended default; thinking off for snappy onboarding).
  Configurable in `src/lib/onboarding.ts` → switch to **`claude-haiku-4-5`** for cheaper/faster
  onboarding (high-volume, margin-sensitive extraction — recommended for production).
- System prompt forbids inventing prices/hours/services (§8); unknown fields return empty.

### Flow
- **2-screen flow, not a 6-step wizard**: URL entry (`/clients/new` → "From website" tab) →
  scrape + structure populates a **draft** client → operator reviews/edits on the **existing client
  detail tabs** (reuses Phase 1 UI; `?onboarded=1` shows a review banner) → provision. The draft is
  created *before* scraping so a failure still leaves a usable client; structuring degrades to manual
  entry when `ANTHROPIC_API_KEY` is unset.

### Demo
- **`/demo`** sales page (§11 screen 9): click-to-call number (`DEMO_PHONE_NUMBER`) + sample
  transcript + talking points.

## Phase 1 — Revenue slice

### Architecture
- **Mutations via Server Actions + React 19 `useActionState`**, not the PRD §14 REST
  routes, for internal operator CRUD. Simpler, type-safe, less boilerplate. Tenant scoping is
  enforced inside every action (`requireOperator()` → `assertClientInOrg()`), never the UI alone.
  Route Handlers are used **only for machine callers**: `POST /api/webhooks/retell` and
  `POST /api/agent-tools/*` (as §14 requires).
- **Data-access layer** in `src/lib/data/*` — every function scoped by `org_id`/`client_id`.
- **Forms**: native `<form>` + `useActionState` + zod validation; styled **native `<select>`**
  (`NativeSelect`) instead of Base UI Select — reliable form submission, no client JS.
- Money entered in **dollars** on forms, stored as **cents**.

### Retell
- Default LLM model **`gpt-4.1-mini`** (cost/margin-friendly for a receptionist); configurable.
- The four tools (§9.4) are **custom function tools** POSTing to `/api/agent-tools/*`, per the PRD.
  **`transfer_to_human` returns the escalation number** — for a true warm transfer, upgrade it to
  Retell's native `transfer_call` tool (refinement).
- **Boosted keywords auto-derived** from business + active service names at provision (no column
  for custom keywords yet).
- Phone binding uses `inbound_agents: [{ agent_id, weight }]` (SDK changed from the PRD's
  `inbound_agent_id`).

### Pipeline
- **Agent-tool auth**: shared secret in the tool URL (`?client=&token=`), timing-safe compare.
  **Reject empty token/secret** — fixed an `??` fallback that let an empty `RETELL_API_KEY` become
  the secret (empty buffers compare equal → auth bypass). Use `||`, and guard empties.
- **Call linking**: `call_started` upserts a minimal `calls` row so mid-call tools can attach
  appointments/leads by `retell_call_id`; outcome is classified on `call_ended`/`call_analyzed`.
- **Owner alerts** go by **SMS to `escalation_number`** (no owner-email column yet), logged to
  `notifications`. Email owner alerts arrive with Phase 3 (digests need an owner email too).

### Booking
- **Cal.com v2** client (`cal-api-version: 2024-08-13`). Field shapes should be confirmed against
  your account's API version before going live. Single `CALCOM_EVENT_TYPE_ID` for v1 (per-service
  event-type mapping later).

## Phase 0 — Foundation

### Naming
- **Product name: FrontDesk AI** (PRD working title "RingPilot" was swappable; operator
  chose FrontDesk AI). Package + folder: `frontdesk-ai`.

### Confirmed from PRD open questions (§18)
- **Auth: Clerk** — kept the PRD default (operator chose Clerk over a custom JWT approach).
- **ORM: Drizzle** — kept the PRD default.
- **Booking provider: Cal.com** — confirmed as v1 default, behind a `BookingProvider`
  interface (`src/lib/booking.ts`); Google Calendar stubbed behind the same shape.
- **Numbers: forwarding-first** — schema carries both `retell_phone_number` and
  `forwarding_number`; provisioning vs. forwarding handled in Phase 1.
- **Recording disclosure**: per-client toggle `recording_disclosure_enabled` (default **on**)
  + optional `recording_disclosure_line` (§12). State lookup is a later enhancement.

### Stack specifics
- **Next 16 middleware → `src/proxy.ts`.** Next 16 renamed the middleware convention to
  "proxy" (`middleware.ts` still works but is the legacy name). Clerk 7.4.3 supports both on
  Next 16 (`isNext16OrHigher ? ["middleware","proxy"]`), so we use the modern `proxy.ts`.
  The build confirms it: `ƒ Proxy (Middleware)`.
- **shadcn "base-nova" style → Base UI, not Radix.** `create-next-app` + `shadcn init`
  produced components built on `@base-ui/react`. They use a **`render` prop** instead of
  Radix's `asChild`, and Tooltip uses `delay` (not `delayDuration`). UI code must follow the
  Base UI idiom. (Noted in AGENTS.md.)
- **DB driver: postgres-js** (`drizzle-orm/postgres-js`). Standard TCP — works with **local
  Postgres in dev** and **Neon in prod** (use the pooled connection string; postgres-js honors
  `?sslmode=require`). Supports multi-statement transactions, which Phase 1 booking needs.
  _(Originally scaffolded with Neon's HTTP driver; switched when wiring local dev, since
  neon-http only reaches Neon's cloud endpoint and can't connect to a local Postgres.)_
- **Dev database: local Postgres** (Homebrew `postgresql@16`, db `frontdesk_ai`). Auth in dev
  uses **Clerk keyless mode** (`.clerk/.tmp/`) — a temporary instance, no signup needed. Both
  swap to cloud (Neon + real Clerk keys) by editing `.env.local`.
- **Dev port 3300** (TeeScout uses 3200; avoids collision).

### Data model choices
- **Money as integer cents** throughout (e.g. `price_cents`, `monthly_price_cents`). The PRD's
  `price` becomes `price_cents`.
- **`notifications.to` → `recipient`** (`to` is a SQL reserved word).
- **`business_hours`**: unique `(client_id, day_of_week)` — one open/close window per day for
  v1 (split shifts deferred). Times stored as `"HH:MM"` text in client-local time.
- Added **`clerk_user_id`** to `users` (unique) to map Clerk identities → our rows; not in the
  PRD column list but required for Clerk sync.
- Idempotency: unique `(source, external_id)` on `webhook_events`; unique `retell_call_id` on
  `calls` for safe webhook upserts.

### Service-layer choices
- **env handling is lenient** — `src/lib/env.ts` never throws at load; `integrations.*()` guards
  let optional integrations no-op (the Notifier returns `{ skipped: true }` without keys) so dev/CI
  boot without every key. `DATABASE_URL` throws only when the db client is actually used.
- **Retell signature verification is manual HMAC-SHA256** — `retell-sdk` 5.36 ships no `verify`
  helper. `verifyRetellSignature` HMACs the raw body with the API key, timing-safe.
  **TODO(Phase 1): confirm against Retell's live signing scheme before trusting in prod.**
- **Org/operator bootstrap on first login**: `getCurrentDbUser()` creates a default org +
  operator user the first time a Clerk user hits the dashboard (single-agency v1).

### Pricing
- Plans (`src/config/plans.ts`): **Starter $300 / Pro $450 / Scale $600** monthly; setup
  **$750 / $1,000 / $1,500**; 14-day trial. Margin cost assumptions encoded for the EPIC A4
  margin view. Editable without touching billing logic.

## 2026-07-30 — Calendars: native Outlook, verified Cal.com keys, video links

- **Native Outlook / Microsoft 365 OAuth** (`src/lib/microsoft-calendar.ts` + Graph booking
  provider): one-click connect like Google, replacing the Cal.com bridge whenever
  `MS_CLIENT_ID`/`MS_CLIENT_SECRET` are set (Azure app registration, multi-tenant, scope
  `Calendars.ReadWrite`). Microsoft **rotates refresh tokens** — the provider persists the
  rotated token via callback; without it connections die in ~90 days. Bridge remains the
  fallback when the Azure app isn't configured, and for Apple/other calendars.
- **Cal.com keys are verified at connect time** (v1 `/event-types` probe) and the default
  event type is auto-selected — the "Event type ID" field is gone. A key that would fail
  mid-call now fails in the owner's face at setup, with a fix-it message.
- **Video-friendly services** (`services.virtual_ok`): per-service toggle; bookings on a
  connected Google calendar get a **Meet** link (conferenceData), on Microsoft a **Teams**
  link (isOnlineMeeting, degrades gracefully for mailboxes without Teams). Link is stored on
  the appointment (`appointments.meeting_url`), shown in the owner's booking email and in
  reminder texts. **Zoom was considered and rejected**: separate OAuth app + marketplace
  review for a capability most local-service callers can't use; Meet/Teams ride the calendar
  connections we already hold.

## 2026-09-30 — Security hardening (audit follow-up)

- **Agent-tool auth is per tenant and signed.** Tool URLs carry
  `HMAC(AGENT_TOOLS_SECRET, "agent-tools:v1:" + clientId)` instead of the raw secret, and
  every call must also carry a valid `x-retell-signature` (Retell signs custom-function
  calls with the API key, same scheme as webhooks — docs.retellai.com "Verify the request
  is from Retell") or our own per-client `x-frontdesk-chat-signature` (web chat → tools).
  The handler's channel (`voice` / `web_chat`) comes from which signature verified.
  - **Legacy compatibility:** URLs still holding the shared secret (agents not re-synced
    since this change) are accepted only on a Retell-signed call whose `call.agent_id` is
    that client's agent. After deploy, run Settings → Re-sync agents; once every agent has
    the new URLs, delete the legacy branch in `src/lib/agent-tools-auth.ts`.
  - **Rollout escape hatch:** `AGENT_TOOLS_SIGNATURE_MODE=report` logs unsigned calls
    instead of rejecting them. Default (unset) is `enforce`. This also resolves the old
    TODO above: if Retell-signed tool calls verify in production, the scheme is confirmed.
- **Cancelling requires proof.** Voice: only the calling number (caller ID). Web chat: a
  6-digit code texted to the number on the booking (stateless HMAC, 10–20 min validity,
  throttled). No details are revealed before verification.
- **Web-chat caps are durable** (`agent_runs` kinds `web_chat_turn` / `web_chat_sms`,
  manual migration `drizzle/manual/0006_web_chat_limits.sql`, in-memory fallback until it
  lands): 300 model turns / business / day; 3 chat-triggered texts per number and 40 per
  business per day. Paused/churned businesses get no chat.
- **Stripe webhook** reprocesses any replay whose ledger row isn't `processed`/`ignored`;
  a failed handler marks the row `failed` and returns 500 so Stripe's retry lands.

## 2026-09-30 — SMS consent gate + enforced AI disclosure (audit follow-up)

- **Stored consent is required** before recall, review-request, recovery (lead + no-show)
  texts, and an owner's one-tap lead follow-up text: the number must have an
  `sms_consents` row for that business under a wording listed in `CONSENT_COVERAGE`
  (`src/lib/data/sms-consents.ts`). Lookup errors fail safe (no send). Opt-out (STOP)
  is still checked as before. **Open policy question:** `booking-v1` is currently mapped to
  every purpose; if recall/review requests are promotional under the published policy,
  remove it from those lists until a separate consent script + campaign use case exist.
- **AI disclosure lives in `begin_message`**, not only in the prompt: `openingLine()` /
  `withRequiredDisclosure()` prepend a fixed sentence whenever the greeting doesn't clearly
  say it's an AI (and, if enabled, that the call may be recorded). Applies to publish,
  provisioning, paused mode and AI outbound callbacks. The recording toggle remains
  operator-only; AI disclosure is unconditional.

## 2026-09-30 — SMS replies inbox (portal → Messages)

- **`sms_messages` stores both directions** (manual migration
  `drizzle/manual/0007_sms_messages.sql`). Inbound: every message the Twilio webhook
  verifies — replies *and* STOP/START/HELP — with `provider_sid` = MessageSid (unique, so a
  replay is stored once and the owner isn't re-emailed). Outbound: customer texts sent via
  `notifier.sendSms({ ..., log: { clientId, kind, appointmentId?, leadId? } })`. Owner
  alerts, digests and one-time cancel codes deliberately pass no `log` and are not stored.
- **Tenant attribution for inbound:** `To` matched to a business line → else the business
  that last texted this customer (inbox log) → else the legacy reminders lookup. With one
  shared sending number, a customer texted by two businesses is attributed to the most
  recent one; per-business numbers would remove that ambiguity.
- **Compliance first:** the opt-out/opt-in write happens before the message is stored,
  and storing never throws, so a storage failure can't cost anyone their opt-out.
- **Read-only.** No reply-from-app (superseded — see "Messages: reply by text" below). Opening a thread marks it read (not in operator
  preview). Every read is scoped by the session's `clientId`.

## 2026-09-30 — Messages: reply by text (portal → Messages → conversation)

- **Who/what can be texted.** `sendMessageReplyAction` (`src/lib/actions/messages.ts`)
  takes the business from the session (`resolvePortalClient`), never the form, and only
  texts a number that already has rows in `sms_messages` for that business. Staff
  (client_viewer) may reply, like reminders/lead follow-ups; an operator *previewing* a
  portal may not (texting in a business's name is the business's call).
- **Consent.** The published /sms-consent policy says "a caller who texts the business's
  number first also consents to receive a reply to that message" (consent is per
  business). So: if the customer has any inbound message in this business's thread, the
  reply is conversational and needs no stored consent row. If the thread is only our
  automated texts, a stored consent covering the new `portal_reply` purpose is required
  (mapped to `booking-v1`, same as `lead_followup`) and "Reply STOP to opt out." is
  appended. STOP (`isOptedOut`, fail-safe) always blocks.
- **Names the business.** The policy also says every message names the business, and all
  businesses share one sending number, so a reply is prefixed `Business Name: ` unless
  the owner already typed the name.
- **Caps.** PR #2's `allowChatSms` caps are for anonymous, chat-triggered texts, so they
  aren't reused. Owner replies get their own durable caps counted from `sms_messages`
  (kind `portal_reply`, rolling 24h): 20 per customer, 100 per business. No new enum
  value or migration. Max 480 characters (same as lead follow-ups); empty input rejected.
- **Recording + routing.** Sent through `notifier.sendSms` with
  `log: { clientId, kind: "portal_reply" }`, which records the outbound row (sent/failed,
  provider sid, error). That row also keeps shared-number reply routing pointed at this
  business. When Twilio isn't configured (demo/dev) nothing is sent or recorded and the
  owner is told so, same as reminders. Sending marks the thread's inbound messages read.

## 2026-09-30 — Guided setup: "Hide for now" + testable checklist rules

- **Mostly already there.** The portal Overview's "Get your AI ready" checklist
  (`SetupChecklist`, `getClientSetupStatus`) already tracks real data: services, hours,
  FAQs, greeting, calendar, alerts, activation (agent + number), call forwarding (with the
  real dial code) and a test call. Each step links to the existing page for it. It shows
  until the owner clicks "I'm done" (which runs the AI readiness review), and lives on under
  Settings → Setup. None of that was rebuilt.
- **Added: dismiss without finishing.** "Hide for now" on the Overview stores
  `setup_flags.checklistHiddenAt` (jsonb, **no migration**). Progress keeps tracking real
  data. Settings → Setup shows "Show on Overview", and the existing reopen action now clears
  the hidden flag too.
- **Agent sync** needs no separate step. Every save in Services/Hours/Knowledge/Your AI
  republishes the live agent (`applyClientEdit`) and says so if it couldn't. The activation
  step's ticked row now says so.
- **Refactor for tests:** step rules moved into pure `src/lib/setup-steps.ts`
  (`buildSetupSteps`, `checklistMode`), and `data/setup.ts` only gathers the facts.
  Behavior is unchanged.

## 2026-09-30 — Calendar sync: finish the two-way loop (Google + Outlook)

Most of calendar sync already existed (Google + Microsoft OAuth, encrypted refresh
tokens via `src/lib/crypto.ts`, free/busy → slots in `check_availability`, AI bookings
create events, portal/AI cancellations delete them, Cal.com as the bridge for
everything else). This change closes the gaps rather than adding a parallel system:

- **Busy time now blocks caller-named bookings too.** `check_availability` already
  subtracted calendar busy time, but `book_appointment` accepted any time the caller
  named, and Google/Outlook happily create overlapping events. The booking path now
  calls `calendarSlotIsFree()` (new optional `BookingProvider.busyBetween`, implemented
  for Google freeBusy and Graph calendarView) **before anything is written**. If the
  calendar can't be read, the caller is told the time isn't available, same as a
  failed event insert. Cal.com refuses clashes itself, so it doesn't need the hook.
- **Connecting republishes the agent.** The Google/Microsoft callbacks now call
  `applyClientEdit` (the Cal.com path already did), so the live prompt starts
  promising bookings immediately instead of at the next unrelated edit.
- **Env gating.** The Google tile is hidden unless `GOOGLE_CLIENT_ID/SECRET` are set
  (it used to lead to a 400 page). Microsoft reads `MICROSOFT_CLIENT_ID/SECRET`, with
  the older `MS_CLIENT_ID/SECRET` still accepted.
- **Settings.** Connect/disconnect also lives in portal → Settings → Calendar; the
  OAuth round-trip returns to the page it started from (allowlisted, via `state`).
- **Disconnect revokes Google's grant** (best-effort `oauth2.googleapis.com/revoke`);
  the stored token is deleted either way. Microsoft has no per-token revoke for
  delegated grants.
- **Not done (open):** free/busy reads only the connected account's primary calendar;
  appointments added by hand in the portal aren't pushed to the calendar; no
  reschedule sync (cancel + rebook works); Google "unverified app" review is still
  needed for production.

## 2026-09-30 — Reply alerts (customer texted → email the business)

- **Extends what was there.** The Twilio webhook already emailed `owner_email` — but only
  when the texter matched a lead, and with no throttle, no alert-roster routing and no
  record. Now every new inbound customer text (replies, YES/START, and STOP-with-a-message;
  not bare keywords, not Twilio replays) goes through `notifyOwnerTextReply`
  (`src/lib/reply-alerts.ts`). Lead matching still stamps `last_reply_at` so recovery stands
  down.
- **Email only, never SMS.** Recipients come from `getAlertRecipients` (on-duty alert roster
  → on-the-clock staff → owner email) and only its **emails** are used. The alert phone is
  never texted for these — a conversation can be a dozen messages and the owner's cell is
  the channel we can't make noisy.
- **Throttle: one alert per conversation (business + customer) per 15 minutes.** State is
  the `notifications` table itself (type `system`, `payload.kind = 'sms_reply'`,
  `payload.customerPhone`); a `pg_advisory_xact_lock` on (business, customer) makes the
  check-and-claim atomic so simultaneous texts can't both send. A failed send doesn't count,
  so the next text retries. No migration.
- **Unread badge** on the Messages nav already existed (PR #7: `countUnreadMessages` →
  `PortalNav`/`PortalTabBar`), so nothing was added there. No in-app bell: the email path
  exists, and the badge is the in-app signal.
- **No per-person on/off switch for reply alerts yet.** Taking someone off duty in the alert
  roster stops all their alerts, including these.

## 2026-09-30 — Weekly summary email (extends the Monday owner report)

- **Extends what was there.** `/api/cron/weekly-report` (Mondays 15:00 UTC, already in
  vercel.json) already emailed each live/trial business's `owner_email` via Resend
  (`sendWeeklyReports`). It had no opt-out, no dedupe (a second run re-sent everything) and
  no cancellations, missed calls won back or texts. No new cron and no new provider.
- **Numbers (last 7 days, all from existing tables):** calls answered (`calls`), appointments
  booked (created in window, not cancelled/no-show) with held-revenue vs upcoming kept
  separate as before, cancellations (`status = 'cancelled'` with `updated_at` in window;
  there is no `cancelled_at`), after-hours saves, new leads, customer texts (inbound
  `sms_messages`).
- **"Missed calls won back"** = distinct customers who texted back (not STOP/HELP) within
  14 days of an automated `recovery_lead` / `recovery_no_show` text from that business. It
  reads 0 for businesses without outbound recovery turned on. This definition is a product
  call and easy to change (`getWeeklyActivity`).
- **Opt-out:** `clients.weekly_summary_enabled` (default on), Settings → Alerts → "Weekly
  summary email". Every email links there.
- **Dedupe:** `weekly_summary_sends` with unique `(client_id, week_key)` (ISO week, UTC). The
  run claims the row *before* sending, so retries and overlapping runs can't double-send. A
  week that failed, or was skipped because Resend isn't configured, may be retried. A row
  stuck in `sending` (crash mid-send) blocks that week, which is safer than a duplicate.
- **Migration:** `drizzle/manual/0008_weekly_summary.sql` (idempotent).
- **Preview:** `/portal/settings/weekly-summary` renders the business's real email for the
  last 7 days without sending.
- **Not changed:** the Monday weekly *SMS* digest to the escalation number (`sendDigests
  ("weekly")`) still runs from the same cron and isn't covered by this opt-out or dedupe.

## 2026-09-30 — Team access: owner vs staff

- **Kept the existing model, no Clerk Organizations.** Membership already lives in our
  `users` table (`client_admin` = owner, `client_viewer` = staff) and reaches new
  accounts through Clerk invitation `publicMetadata` `{ role, clientId }`. Switching to
  Clerk Organizations would mean migrating every tenant for no user-visible gain. No
  schema change; no migration.
- **Two tiers.** Staff: calls, appointments, leads, messages, replies (unchanged), plus AI
  settings if the owner shares the edit code (unchanged). Owner only, and never
  unlocked by the edit code: billing checkout, trial code, the team, and where alerts
  go (alert email, alert/transfer phone, SMS-alert toggle, weekly-summary email
  toggle, adding/removing roster people). Staff can still flip roster people on/off duty — that's a day-to-day job.
  Enforced on the server with `requireClientOwner` / `userIsClientOwner`
  (`src/lib/auth-guard.ts`); the UI hides/disables the controls as well.
- **Settings → Team** (`/portal/settings/team`, owner-only): invite as staff or owner,
  pending invites with cancel, change role, remove. A business can't drop to zero
  owners (agency operators are exempt, so they can repair it).
- **Removal** clears the Clerk metadata FIRST (else the next sign-in would re-create the
  membership from it), then soft-deletes the row and nulls `clerk_user_id` (unique
  index). If Clerk can't be reached, nothing is removed. The Clerk login itself is
  left alone.
- **Existing Clerk accounts.** Clerk only copies invitation metadata into NEW accounts,
  so inviting an email that already has a Clerk sign-in but no live FrontDesk login
  (typically someone removed earlier) sets the metadata directly; they join on their
  next sign-in. An email with a live FrontDesk login is refused (one login = one
  business).

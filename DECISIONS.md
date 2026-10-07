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

## 2026-09-30 — AI text replies (customer texts → Claude answers)

- **Off by default, per business.** `clients.ai_text_replies_enabled` (default false),
  Settings → Follow-ups → "AI text replies" (owner/admin only, audited). Trial/live
  businesses only. Migration `drizzle/manual/0010_ai_text_replies.sql` (also adds
  `clients.ai_text_pause_hours` and the `sms_threads` table) — **renumber at merge** if
  another branch took 0010.
- **Only ever a reply.** It runs on an inbound text, so the customer texted first — the
  consent the published /sms-consent policy grants for a reply (same reasoning as owner
  replies). STOP (`sms_opt_outs` + `client_sms_opt_outs` via `isOptedOut`, fail-safe) is
  checked before the model and again right before sending. STOP/HELP keyword texts never
  reach it. Customer texting hours (9:00–20:00 local, `withinTextingHours`) apply; outside
  them the owner gets the normal reply alert and nothing is texted.
- **Same booking logic as the phone agent.** check-availability / book / cancel are the
  existing `/api/agent-tools/*` endpoints, called over HTTP exactly like the web chat does,
  with a new per-client, domain-separated signature (`x-frontdesk-sms-signature`,
  "sms-tools:v1:"). `authorizeAgentTool` reports channel `sms` only from that signature. The
  signed `call.from_number` is the Twilio-verified sender, so:
  - **cancel** treats it like voice caller ID: a texted request from the same number is
    verified; a number typed into the conversation is refused; no code is texted.
  - **book** always books under the texting number (a typed number is ignored), and starts
    no consent receipt / confirmation-reminder series (the AI's reply is the confirmation).
    **Open:** whether an SMS booking should count as consent for the day-before reminder.
  - Reschedule = book the new time, then cancel the old one (prompt rule; the tools enforce
    who may cancel). There is no separate reschedule endpoint.
- **Prompt-injection posture** (`src/lib/sms-ai/rules.ts`, pure + tested): business facts
  (services/hours/FAQ/guidance, `ownerText`-sanitized) first, our rules LAST and winning;
  the thread goes in as a fenced `<transcript>` user turn with tag-like text neutralized,
  labelled Customer / Business / You (AI). Tools are only availability/book/cancel plus two
  decision tools (`send_reply`, `handoff_to_owner`) — nothing can touch the live agent,
  knowledge or settings. Every draft passes `guardReply` (no links, phone numbers, prompt
  talk, 6-digit codes; ≤320 chars) or it isn't sent and the thread is handed off.
- **Handoffs.** Emergencies, "get me a person / call me", and sensitive topics (refunds,
  complaints, legal, medical) are detected on the raw text BEFORE the model (so injection
  can't argue past them). The model can also hand off when unsure. A handoff pauses AI in
  that thread (`sms_threads.ai_paused`, reason `handoff:<why>`), sends a TEMPLATED holding
  text (emergencies say "call 911"), and sends the existing reply-alert email with a
  "Needs you:" subject and the reason. A model/tool error falls back to the plain alert.
- **Owner stays in charge.** While the AI is handling a thread, the per-text reply-alert
  email is skipped (the owner hears on handoff instead) — **open decision**: some owners may
  want every text emailed anyway. A manual portal reply pauses the AI in that thread for
  `ai_text_pause_hours` (default 12; 2/6/12/24/48), computed from `sms_messages` (no extra
  write). Messages → conversation shows the AI status with **Pause AI / Resume AI** (staff
  may use it; operator preview may not).
- **Marked as AI.** Stored in `sms_messages` with kind `ai_reply` / `ai_handoff` (free-text
  column, no enum change); the thread shows an "AI" badge and the list previews "AI: …".
- **Caps** (from `sms_messages`, rolling 24h): 10 AI texts per thread, 200 per business. At
  the thread cap the AI hands the conversation to the owner (no holding text).
- **Concurrency.** A short claim on `sms_threads.ai_busy_until` stops two texts arriving
  together from producing two replies; the run re-checks for a newer text before finishing.
- **Model:** `CHAT_MODEL` (Haiku by default, env-overridable), same as the web chat.
  Recovery's comment "unattended sends are templated, never LLM text" still holds for
  outbound campaigns; this feature is a reply inside a conversation the customer started,
  gated as above — but it IS model text leaving unattended, which is why it's opt-in.

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

## 2026-09-30 — Daily owner briefing (morning email + Overview card)

- **What it is.** An opt-in email around 7–8am in each business's own timezone: yesterday's
  calls/bookings/cancellations, who needs a call back, today's schedule, anything urgent.
  `src/lib/daily-briefing.ts` (pure: windows, grounding, rendering), `data/daily-briefing.ts`
  (queries + dedupe), `agents/briefing.ts` (the model's part), `briefing-send.ts` (cron runner).
- **Grounded by construction.** Names, phone numbers, times, counts and the schedule are rendered
  from our tables, never from model output. The model (Haiku, one short call per business per
  day) writes only a 2–3 sentence opening and picks the order to return calls in, citing
  callbacks by ref (`C1`). `groundAiBriefing` drops unknown refs, strips digit runs from notes,
  and throws away the whole opening if it contains any number that isn't one of the counts. No
  key / model error / ungrounded output → our template opening. A quiet day never calls the model.
- **Prompt injection.** Lead reasons/messages are caller-authored, so they go to the model inside
  `<caller_data>` fences (fence-closing characters stripped, one line, capped), with a system rule
  that fenced text is data, never instructions. Names and phone numbers aren't sent at all.
- **"Needs a callback"** = leads still `new`, not replied to by text, from the last 7 days, plus
  yesterday's calls where the call-health rules say a transfer hit voicemail / dropped, or the
  caller asked for a person and didn't get one, and no message was taken. Urgent = the same kind
  of keyword list as call health (flood, leak, ASAP, pain…). Product call, easy to tune.
- **Schedule (Vercel Hobby).** Hobby only allows once-a-day crons and fires them anywhere in the
  hour, so `vercel.json` registers `/api/cron/daily-briefing` eight times (daily at 10:00–17:00
  UTC — 7am somewhere from Atlantic to Hawaii). Each run only touches opted-in businesses for
  whom it's 7–10am locally; the 3-hour window lets a late or missed slot catch up. On Pro, these
  can collapse to one hourly entry. Outside the Americas no slot lands at 7–10am local.
- **Opt-in, off by default** (`setup_flags.dailyBriefing`, jsonb — **no migration**), Settings →
  Alerts → "Morning briefing email", owner-only like the other alert toggles. Off by default so
  existing customers don't get a new daily email unannounced. Sent to the owner email (like the
  weekly summary), **email only — never SMS**.
- **Dedupe:** one `notifications` row per business per local day (type `digest_daily`,
  `payload.kind = 'daily_briefing'`, `payload.dayKey`), claimed under a `pg_advisory_xact_lock`
  before sending (same pattern as reply alerts). Failed or provider-skipped days may be retried by
  a later slot; sent days never resend.
- **Preview:** `/portal/settings/daily-briefing` renders the real briefing for right now and never
  sends or records anything (it does make one model call per view).
- **Overview card** reads the copy stored with today's send — one indexed read, no model call on
  page load. Businesses without the briefing on see a one-line pointer (owners only, once they
  have calls).
- **Not changed:** the existing daily SMS digest to the escalation number (`/api/cron/digest`)
  still runs and isn't tied to this setting.

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

## 2026-09-30 — Per-business texting numbers (optional)

- **`clients.sms_number`** (E.164, nullable; manual migration
  `drizzle/manual/0009_client_sms_numbers.sql`). Null for every business until an
  agency operator pastes one in on the client's Settings tab, so nothing changes on
  deploy. Not reused from `retell_phone_number` / `forwarding_number`: Retell numbers
  live in Retell's account (we can't send SMS from them through our Twilio), and the
  forwarding number is the business's own carrier line.
- **Outbound:** `notifier.sendSms` sends a customer text from the business's own
  number when it has one (business taken from `log.clientId`, or `fromClientId` for
  unlogged texts like cancel codes), else from `TWILIO_FROM_NUMBER`. Owner/staff
  alerts and digests always use the shared number. A failed lookup falls back to
  the shared number.
- **Inbound routing:** `To` = a business's own number → that business, nothing else
  consulted. Otherwise (shared number) the old fallback, but "who last texted this
  customer" now only counts texts sent from the number they replied to (plus old rows
  with no number), so a reply to the shared line isn't credited to a business that
  texted from its own number.
- **STOP/START scope.** `sms_opt_outs` is unchanged and still means "STOP to the
  shared number" → blocks every business. A STOP to a business's own number goes to
  the new `client_sms_opt_outs` and blocks **that business** (from any number, so
  removing its number later can't route around the STOP via the shared line). START
  lifts only the opt-out for the number it was sent to. `isOptedOut(phone, clientId)`
  checks shared + that business; callers that don't pass a business get "any STOP
  anywhere" (the conservative answer). An unmatched `To` is treated as the shared
  number (broader scope). Twilio's own carrier-level block is per number (or per
  Messaging Service, which is broader) — ours is never looser than Twilio's.
- **Assignment is operator-only and never buys anything.** Agency operators only
  (`requireAgencyOperator`), org-scoped. The number is checked read-only against our
  Twilio account (exists, SMS-capable, not the shared number, not assigned to another
  live business — also enforced by a partial unique index). A number whose "A message
  comes in" webhook doesn't point at `/api/webhooks/twilio` is saved with a warning.
  Assign/remove are written to `audit_log`.

## 2026-09-30 — Setup: smoother onboarding + security hardening (setup-flow audit)

- **One signup, one business, one phone number.** `attachCreatorToClient` now claims the
  account atomically (`UPDATE users … WHERE client_id IS NULL`) *before* website drafting
  and provisioning; a losing request (the setup form's second button, a double-click, a
  replayed POST) soft-deletes the business it created and stops. Operators may only use
  `/welcome` for a workspace's first business (earliest wins). A first provision (the
  one that buys a Retell number) takes a short lock in `setup_flags.provisioningAt`
  (`src/lib/provision-lock.ts`, 3-minute expiry, jsonb, **no migration**), so a
  double-clicked Activate can't buy two numbers.
- **Credentials stay on the server.** Portal settings pages passed the whole `clients`
  row to client components, which put `calendar_secret` (encrypted OAuth refresh token /
  Cal.com key) and `edit_code_hash` into the page payload — for staff too. They now pass
  `toSafeClient()` (`src/lib/client-safe.ts`). The operator dashboard still passes full
  rows (agency operators only); worth the same treatment later.
- **Owner/website text is data, and our rules win.** Guidance was labelled "highest
  priority — follow this exactly" above the safety/disclosure rules, and guidance is
  auto-drafted from any website a signup names. The prompt now opens its Rules with
  `RULES_PRECEDENCE` (rules beat business text), the guidance heading says "within the
  Rules", and owner text (guidance, booking rules, services, FAQ) has line-leading `#`
  stripped so it can't open a fake section (`ownerText` / `ownerLine`). Drafted content
  is capped to the manual forms' limits (40 items; same char limits).
- **Validation.** Hours must be 24-hour `HH:MM` (form and website draft; bad drafted days
  are dropped). Drafted phone → E.164. Intake: zod limits (guidance 4,000 chars), bare
  domains accepted, the cell-number error is actually shown, values survive an error,
  6 submits/link/hour (in-memory, per instance), no website re-draft once services/FAQs
  exist (it used to duplicate them and re-run the paid scrape), and changes republish a
  live agent. Signup form keeps what was typed on a validation error (React 19 resets
  forms after an action).
- **Role checks.** Google/Microsoft calendar connect + callback require editor rights
  (`userMayEditClient`), matching the Cal.com action; staff see the unlock banner.
  Self-serve checkout refuses a business that's already subscribed or comped.
- **Smaller:** website import caps HTML at 2 MB and blocks a few more private ranges
  (198.18/15, 192.0.0/24, fec0::, NAT64, ::127.x); trial codes use `crypto.randomInt`.
- **Setup checklist:** test call now comes *before* forwarding the business line;
  Missed-Call Rescue gets a no-answer-forwarding hint instead of `*72` (which forwards
  every call); the calendar step links to Settings → Calendar. The "Receptionist is on"
  switch is hidden until an AI exists; owners no longer see "add a payment method in
  Retell" when a number can't be bought.

## 2026-09-30 — Call recaps (messages + transfers → one alert per call)

- **What triggers one.** An inbound call where the AI took a message (a lead on the call,
  including on a call that also booked), or transferred the caller to a person: connected
  (`transfer`) or failed (`transfer_failed`: rang out to voicemail, dropped right away, or
  Retell `disconnection_reason = transfer_cancelled`). Transfer detection uses Retell's
  `disconnection_reason` (`call_transfer` / `transfer_cancelled`) and `Transfer Target:`
  transcript lines (`transferStatus` in `src/lib/call-recap.ts`). Outbound calls and spam
  never recap.
- **What it says:** who called (name and number, plus the callback number if it differs from
  caller ID), whether they're an existing customer (past non-cancelled appointments, upcoming
  appointment, prior calls), what they want (lead reason/service, then extraction, then
  Retell's summary), urgency, the suggested reply (`call_insights.follow_up_draft` from
  extract.ts, labelled as an AI draft), and a link to `/portal/calls/{id}`. Built by rules,
  not a model, so it adds no new prompt-injection surface. Caller-derived text is escaped,
  length-capped and shown as the caller's words.
- **When:** on `call_analyzed`, right after `extractCallInsights` (chained in one `after`),
  so the suggested reply is ready. Once per call: an advisory lock plus an existing
  `notifications` row with `payload.kind = 'call_recap'` and `payload.callId`. A send that
  failed doesn't count, so a retry can try again. No migration.
- **Dedupe (one alert per call):**
  - The message tool no longer sends the mid-call "New message" alert on inbound phone
    calls that already have a call row. The recap replaces it. Web chat, and the rare voice
    lead with no call row yet, still alert right away (`leadAlertDeferredToRecap`).
  - The call-problem alert (`notifyOwnerCallProblem`) is skipped when a recap is due. Its
    emergency and transfer-failure findings are folded into the recap.
  - `analyzeCall` now gets `transferConnected` from the real transfer signal. It used to be
    `outcome === "escalated"`, which nothing sets, so a caller who asked for a person and
    was successfully transferred was alerted as "stranded".
- **Channels:** email to `getAlertRecipients` emails, always. SMS to its phones **only when
  `sms_alerts_enabled` is on AND that kind of alert already went by SMS**: messages (the old
  lead alert texted), failed transfers (the old stranded-caller alert texted), and anything
  urgent (the old emergency alert texted). A transfer that connected is email-only. It's
  informational, and the owner's phone isn't the place for it.
- **Trade-offs:**
  - A voice message's alert now arrives when the call ends plus analysis time (usually
    seconds), not mid-call.
  - If Retell never sends `call_analyzed` for a call, the deferred message alert doesn't go
    out. The lead is still in the portal.
  - The call-problem alert for calls with no recap can still fire on both `call_ended` and
    `call_analyzed` (existing behaviour, unchanged here).

## 2026-09-30 — Multilingual answering (caller's language, configurable list)

- **Setting:** Settings → Phone & AI → Languages. The owner picks which language calls open in
  (English or Spanish, the two greetings we've written) and up to 3 other languages the AI
  switches to when a caller speaks them. The default is English only. It's stored in the
  existing `clients.languages` text column (no migration):
  - `en`, `en-es` and `es` keep their meaning and are still written for those shapes.
  - Anything else is a comma list, primary first (`en,es,fr`). See `src/lib/languages.ts`.
  - The old selector in General was removed so there's one place to set this.
- **Choices offered:** the ten languages Retell's legacy "multi" setting covered (en, es, fr, pt,
  de, it, ru, hi, ja, nl). That set is known to work together in Retell's multilingual speech
  recognition. Retell supports many more locales, but each combination must be covered by the
  voice and by one recognition provider. Add more only after a test call.
- **Retell:**
  - Agent `language` is now an explicit locale array for multilingual agents (`["en-US","es-ES"]`,
    primary first, which is also Retell's pronunciation fallback), or one locale.
  - The scalar `"multi"` we used to send is deprecated. Retell still accepts it but stores it as
    all ten legacy locales, which is the least accurate setup.
  - Any non-English agent also pins `voice_model: eleven_flash_v2_5`, because our voices are
    ElevenLabs and the English-only models can't speak other languages. English-only agents
    are left on Retell's default.
  - Applied on provisioning and on every sync (`agentSpeechSettings`).
- **Prompt:** new rules right after the precedence rule:
  - Detect the caller's language and switch.
  - On switching, the first sentence repeats the AI disclosure (and recording notice when it's
    on) in that language. Spanish has a fixed sentence; other languages get a faithful
    translation.
  - Ask the texting-consent question in the caller's language. Spanish is fixed; other
    languages are translated with STOP kept in English.
  - Pass `language` when booking.
  - Don't translate names.
  - A Spanish-first business opens in Spanish: a Spanish default greeting, and a Spanish fixed
    disclosure is enforced just like the English one (`withRequiredDisclosure(..., { language: "es" })`).
  - `disclosureGiven` (call health) now recognises Spanish disclosures.
- **Texts:**
  - `book_appointment` gets an optional `language` param. It's stored per business and phone in
    the new `customer_languages` table, and the latest call wins.
  - Confirmation and reminder texts use Spanish templates when the customer's language is
    Spanish, with a Spanish date format. STOP stays in English. Every other language falls
    back to English.
  - Reads and writes are fail-soft, so a missing table just means English texts.
- **Consent receipts:** a yes given in Spanish is stored as `booking-v1-es` (and so on for other
  languages), so the receipt says which language the ask was in. `CONSENT_COVERAGE` treats
  translations of booking-v1 as the same consent.
- **Migration:** `drizzle/manual/0012_customer_languages.sql` (new table only, idempotent).
  It's numbered 0012 because the AI text replies PR uses 0010 and the missed-call PR uses 0011. Order between them doesn't
  matter.
- **Cost:** Retell documents no per-language surcharge, and we add none. The trade-off is
  accuracy (the cross-language recognition pipeline is less precise than single-language) and a
  slightly longer prompt.

## 2026-09-30 — Missed-call text-back (and optional AI callback)

- **What triggers it.** Retell's `call_analyzed` webhook, after Agent #2's
  extraction (so the intent/spam flag is available). Pure rules in
  `src/lib/missed-call.ts` decide from Retell's `disconnection_reason`, call
  length, outcome, and intent: **dropped** (`error_*`, concurrency/timeout),
  **hung up early** (caller ended it in under 25s), or **left mid-booking**
  (caller ended it / went silent with booking intent — from extraction, or the
  *caller's* lines in the transcript, never the agent's). Everything else —
  normal conversations, transfers, voicemail, messages taken — is left alone.
- **Who is never texted.** Our own outbound calls (so AI callbacks can't loop),
  spam (extraction flag, `scam_detected`, spam/sales/wrong-number intent, the
  owner's blocked list), anyone who booked on the call or has an upcoming /
  newly-made appointment, anyone who rang back since, non-US caller ID, anyone
  opted out (`isOptedOut(phone, clientId)` — shared and per-business STOP), and
  anyone without a stored consent covering the new `missed_call` purpose.
- **Consent (open policy question).** `missed_call` is mapped to `booking-v1`
  like every other purpose, with a TODO(Ari). In practice that means returning
  customers who agreed to texts get the text-back; a first-time caller who hung
  up after 5 seconds has agreed to nothing and is **not** texted. If counsel
  decides a single reply to someone's own call needs no prior consent, the
  `hasSmsConsent` gate in `src/lib/agents/missed-call-callback.ts` is the one
  place to change.
- **Templated, never model-written.** The text is fixed wording: business name,
  one reason-specific opener, "reply here with a day and time", "Reply STOP to
  opt out." Nothing the caller said is copied in; a service name appears only
  when the extracted service exactly matches one of the business's own services
  (and the business's name is what's printed). This is the prompt-injection
  stance: a caller can't get words into an outbound text.
- **Replies.** They land in the normal Messages inbox (sms_messages, kind
  `missed_call_text` for ours). If AI text replies (PR "AI text replies") is on
  for the business it answers and can book; otherwise the owner gets the usual
  reply alert. No code coupling between the two.
- **Limits.** One per caller per 7 days (advisory-locked per business+phone),
  one row per call (unique `call_id`, so webhook replays are no-ops), 25/day per
  business, 9am–8pm local. A call outside those hours is held as `pending` and
  sent by the new daily sweep (`/api/cron/missed-call-callbacks`, 16:45 UTC) if
  it's under 20 hours old; otherwise it expires. Every gate is re-checked at send.
- **AI callback.** A second toggle, only effective when the platform env var
  `MISSED_CALL_AI_CALLBACKS=on` is set, Retell is configured, the plan includes
  `outbound_ai_calls`, and the business has a Retell number. It goes through the
  same consent/opt-out/hours/cap gates as the text, uses the same disclosed
  begin message pattern as "Call with AI" on leads, and is tagged
  `direction: outbound` so it is never itself treated as a missed call. If the
  call can't be placed, the text goes instead.
- **Storage.** `clients.missed_call_texts_enabled`,
  `clients.missed_call_ai_callbacks_enabled` (both default false) and the
  `call_callbacks` ledger (manual migration
  `drizzle/manual/0011_missed_call_callbacks.sql`; renumber at merge if needed).
  The Settings → Follow-ups card shows last-7-day sent/held/skipped counts.

## 2026-09-30 — Smart rebooking (owner blocks time over existing bookings)

- **Nothing is automatic.** Adding a closure, time off, or a person's leave never
  moves or messages anyone. The "added" toast says how many bookings it lands
  on, and the Hours page lists them ("Appointments in blocked time"). Texts go
  out only when the owner presses "Ask customers to rebook" **and** confirms,
  and only if the business turned on Settings → Follow-ups → "Rebook when you
  block time" (`clients.smart_rebooking_enabled`, default false).
- **Who is affected.** Upcoming (90 days) booked/confirmed appointments that an
  active block overlaps; a provider-specific block affects only that
  provider's appointments (`isAffected` in `src/lib/rebook.ts`).
- **Who is texted.** US mobile on the appointment, not opted out
  (`isOptedOut(phone, clientId)`), and permission: a stored consent covering the
  new `rebook` purpose (booking-v1) **or** a delivered text about this
  appointment (the same inheritance the day-before reminder uses). 9am–8pm
  local only (the button refuses outside it), 50 offers per business per day,
  one live offer per appointment (partial unique index). Skipped customers are
  listed with the reason so the owner can call them.
- **What they get.** A fixed template: business name, the business's own
  service name, the old time, 2–3 numbered openings, "Reply 1, 2 or 3 to
  switch, or NO to cancel. Reply STOP to opt out." Not "CANCEL" — carriers
  treat it as an opt-out keyword. Openings come from the business's booking
  provider (same call as the voice agent's check-availability), are spread one
  per day where possible, are not shared between customers in the same batch,
  and each is re-checked against the booking rules before it's offered.
- **Replies are matched, never interpreted.** `parseRebookReply` accepts a lone
  option number ("2", "#2", "option 2", "the second one", "2 please") or a short
  "no"; anything else ("2 doesn't work", "1 or 2", questions, instructions) is
  marked "needs you" and goes to the owner as a normal reply alert. No model
  ever sees the text. Only the number the appointment is booked under can
  answer, since the offer is looked up by sender (the caller-ID rule).
- **Reschedule = the booking tool's sequence.** Hours/blocks (`checkSlot`),
  capacity or a free team member, real-calendar free/busy, provider booking,
  atomic `reserveAppointment`, and release the calendar event if the reserve
  loses. Only then is the old appointment cancelled (provider + local). If the
  slot is gone, nothing changes, the customer is told someone will text them,
  and the owner is alerted. The offer is claimed (`sent → processing`) first, so
  a Twilio replay or a double reply can't book twice.
- **Decline = cancel + waitlist backfill, if the time is bookable.** The cancel
  tool's `offerFreedSlot` runs only when the freed time isn't inside a
  business-wide block, because a slot inside the owner's own closure isn't an
  opening. A single provider's leave still lets the slot go to the waitlist.
- **Webhook order.** In `/api/webhooks/twilio`, after STOP/HELP handling and
  storing the message, a reply from a number with an open offer (feature on) is
  handled in `after()`. With the AI text replies branch, this check must run
  **before** the AI reply (open offers take precedence). Merge-order note in
  the PR.
- **Storage.** `rebook_offers` (manual migration
  `drizzle/manual/0013_smart_rebooking.sql`; renumber at merge if needed).
  Messages are logged to `sms_messages` as `rebook_offer` / `rebook_reply`.

## 2026-10-07 — Trial-to-paid nudges: countdown, real trial summary, one-click upgrade

- **Countdown everywhere, detail on Overview.** The Overview trial banner now shows days left, the end date in the business's timezone, a progress bar, and three tiles (calls handled, appointments booked, after-hours calls) computed from real data since the trial started (`getTrialProgress`). Every other portal page gets a slim strip (headline + one-line summary + Upgrade); it hides itself on `/portal` so the banner isn't duplicated.
- **Honest numbers.** Calls exclude spam. "Booked" counts only appointments linked to a call (`callId` not null) and not cancelled/no-show, so manual entries by the owner never inflate what "your AI" did. Trial start = `trialEndsAt − TRIAL_DAYS`, never before the client's `createdAt`.
- **Upgrade uses the existing checkout.** The button posts to `startSelfServeCheckoutAction` (owner-only, monthly) for the plan picked at signup, else Starter; the Stripe webhook still owns the subscription row. Viewers, operator previews, and setups without Stripe see a "Choose a plan" link instead.
- **Reminder email is opt-in.** A new d3 email ("You asked us for this reminder…") only sends if the owner ticks "Email me 3 days before it ends" (`setup_flags.trialReminderOptIn`, default off). It rides the existing `runTrialReminders` in the daily retention cron — no new cron, `vercel.json` untouched. The existing automatic d7/d1 emails are unchanged; if d3 went out, d7 is skipped so owners never get two in a row. Tests mock the notifier — no sends.
- **postgres-js gotcha.** Raw `Date` values inside `sql\`\`` fragments throw on postgres-js (PGlite accepts them); pass `toISOString()` with `::timestamptz`.
- No migration; no new env vars.

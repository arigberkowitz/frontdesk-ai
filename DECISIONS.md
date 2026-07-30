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

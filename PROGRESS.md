# PROGRESS

Per-phase status (PRD §15). Newest first.

## Phase 3 — Analytics, ROI & client portal ✅ (code-complete; live sends need keys)

### Shipped
- **Metrics** (`src/lib/data/metrics.ts`): per-client ROI + portfolio aggregates, all in SQL.
- **Operator dashboard**: real portfolio metrics (revenue captured, active clients, calls/bookings
  today, after-hours/week, MRR, est. margin) + per-client status cards.
- **Per-client Overview**: ROI cards (containment, answer rate, sentiment, after-hours) + a
  **Recharts** 14-day calls/bookings chart.
- **CSV export** for calls / appointments / leads (`/api/clients/:id/export`).
- **Read-only client portal** (`/portal`, `/portal/calls` + detail, `/portal/appointments`) with its
  own layout/guard; invite a viewer from a client's Settings (Clerk invitation + role metadata).
- **Digests**: `/api/cron/digest` (CRON_SECRET-protected) → per-client owner SMS, logged to `notifications`.

### Verified
- `typecheck` / `lint` / `build` green — **19 routes** (adds export, cron, portal).
- **Metric SQL validated against seeded data** (totals, after-hours, containment/answer, 14-day
  window, period `make_interval`) — all numbers correct.

### Needs keys to send live
`CRON_SECRET` enables the digest cron; Twilio sends the actual SMS; a real `CLERK_SECRET_KEY` sends
portal invites (keyless dev can't).

### Next — Phase 4
Stripe billing (setup fee + subscription), trial→paid conversion, Stripe webhooks → keep
`subscriptions` in sync, operator margin view (cost side already surfaced on the dashboard).

## Phase 2 — Onboarding engine ✅ (code-complete; AI structuring needs an Anthropic key)

**Definition of done:** _website → AI-drafted agent in minutes._

### Shipped
- **Scraper** (`src/lib/scrape.ts`): cheerio + fetch; homepage + key pages → readable text.
- **Claude structuring** (`src/lib/onboarding.ts`): forced tool call → strict schema → zod, into
  `{ services, hours, address, phone, faq, tone, summary }`.
- **Onboard flow**: `/clients/new` → **From website** tab (name + URL) → creates a draft, scrapes,
  structures, and populates **services / hours / FAQ** → redirects to the client detail with a
  **review banner** (`?onboarded=1`); operator edits on the existing tabs, then provisions.
- **`/demo`** sales page: click-to-call demo number + sample call transcript + talking points.

### Verified
- `typecheck` / `lint` / `build` green — **16 routes** (adds `/demo`).
- **Scraper validated against real sites** (Stripe, Vercel, Anthropic): extracts 1K–10K chars of
  readable text and discovers the right pages (`/pricing`, `/contact`, …). A test caught a
  link-discovery ordering bug (nav stripped before the link scan) — now fixed.

### To run live
Set `ANTHROPIC_API_KEY` for the AI draft (without it, onboarding still creates a bare draft for
manual entry). `DEMO_PHONE_NUMBER` lights up the demo call card.

### Deferred
Headless fallback for JS-rendered sites; a bespoke multi-step wizard (review reuses the detail tabs).

### Next — Phase 3
Analytics & ROI dashboard, read-only client portal, daily/weekly digests, CSV exports.

## Phase 1 — Revenue slice ✅ (code-complete; live calls need vendor keys)

**Definition of done:** _onboard a client, a real call gets answered + booked, owner gets a text._
The full pipeline is built and verified short of a live phone call (which needs a Retell key, a
public webhook tunnel, Cal.com, and Twilio).

### Shipped
- **Client management**: create/list clients; client detail with tabs (Overview, Calls,
  Appointments, Leads, Services, Hours, Knowledge, Agent, Settings); manual **services / hours /
  FAQ** editors; profile edit; **status lifecycle** with the "can't go live without a provisioned
  agent + number" guard; soft delete. All via Server Actions + tenant guards.
- **Prompt template** builder (§9.3) from profile + services + hours + FAQ + disclosure.
- **Retell provisioning** (`lib/retell.ts`): create/update LLM + agent + phone number, idempotent,
  with the four custom tools wired to our endpoints; voice list. Publish snapshots `agent_versions`
  and pushes the prompt.
- **Webhook ingest** (`/api/webhooks/retell`): signature-verified, idempotent (`webhook_events`),
  upserts calls, classifies outcome, computes after-hours in the client's timezone.
- **Agent tools** (`/api/agent-tools/{check-availability,book,message,transfer}`) with **Cal.com**
  booking; bookings → appointments, messages → leads, both fire **owner SMS** (logged to
  `notifications`).
- **Call views**: list + full transcript/recording/summary/outcome detail page.

### Verified
- `typecheck` / `lint` / `build` green — 14 routes incl. the webhook + 4 agent tools.
- **Runtime, against local Postgres**: `POST /api/agent-tools/message` → 401 without token, 200 with
  token, **lead row created** end-to-end (auth → client lookup → lead → owner-notify no-op → DB).
- Caught + fixed a security bug: empty `RETELL_API_KEY` made the agent-tool secret empty, which
  let an empty token authenticate. Now rejects empty token/secret.

### To demo a live call
Set `RETELL_API_KEY`, expose `APP_URL` via a tunnel (ngrok) so Retell can reach the webhook +
tools, add `CALCOM_API_KEY`/`CALCOM_EVENT_TYPE_ID` and Twilio. Then provision a client and call its
number.

### Refinements deferred
- Voice **picker UI** (the `listRetellVoices` API is implemented; the form uses a text input).
- `transfer_to_human` returns the number — upgrade to Retell native warm transfer.
- Confirm Cal.com v2 field shapes against the live API; per-service event-type mapping.

### Next — Phase 2
Website scrape → Claude-structured draft → onboarding wizard → provision; demo-mode agent for sales.

## Phase 0 — Foundation ✅ (running locally)

**Definition of done:** _I can log in and see an empty dashboard._
Runs locally with **local Postgres + Clerk keyless mode** — no cloud accounts needed for dev
(`npm run dev` → http://localhost:3300). Sign up to reach the empty dashboard; point at Neon +
real Clerk keys for production (see README "Setup").

### Shipped
- **App**: Next 16 (App Router, Turbopack) + TypeScript + Tailwind v4 + shadcn (Base UI).
- **Auth**: Clerk wired via `src/proxy.ts` (Next 16 proxy convention). Sign-in/sign-up pages,
  protected `(dashboard)` route group, root → dashboard redirect. Operator + org bootstrap on
  first login.
- **Database**: full PRD §6 schema in `src/db/schema.ts` — 13 tables, 14 enums, UUID PKs,
  created/updated timestamps, soft deletes, idempotency indexes, relations, inferred types.
  Initial migration generated (`drizzle/0000_*.sql`). Drizzle client over Neon HTTP.
- **App shell**: responsive sidebar + topbar (mobile sheet), Clerk `UserButton`. Reusable
  `MetricCard`, `PageHeader`, `EmptyState`. Empty **Dashboard** with zeroed portfolio metrics,
  **Clients/Review** placeholders, and a **Settings → Connections** panel showing which
  integrations are configured.
- **lib services scaffolding**: `db`, `auth-guard` (tenant isolation), `retell`, `notifier`
  (Resend + Twilio, graceful no-op), `booking` (`BookingProvider` + Cal.com/Google),
  `env`, `logger`, `format`.
- **Config**: pricing plans + cost assumptions (§10); app/nav constants; `.env.example`.
- **Docs**: `DECISIONS.md`, this file, `README.md`, project conventions in `AGENTS.md`.

### Verified
- `npm run typecheck` / `lint` — clean.
- `npm run build` — success; `ƒ Proxy (Middleware)` recognized; dashboard routes correctly
  dynamic (auth-gated).
- DB: 13 tables migrated to local Postgres; org+operator bootstrap inserts verified.
- Runtime: dev server serves; `/` and `/dashboard` → 307 → `/sign-in` (auth gate works);
  sign-in page renders via Clerk keyless. _(Post-login dashboard screenshot blocked only by
  Clerk's Turnstile CAPTCHA on automated signup — a human passes it instantly.)_

### Stubbed (intentionally — land in later phases)
- Retell provisioning (`provisionAgentForClient`, `listRetellVoices`) → **Phase 1**.
- Cal.com / Google booking provider methods → **Phase 1**.
- Notifier persists `notifications` rows at call sites → **Phase 1**.
- Dashboard metrics are static zeros (no aggregate queries yet) → **Phases 1/3/4**.

### Next — Phase 1 (revenue slice, highest priority)
Manual client create → prompt template → provision Retell LLM/agent/number → webhook ingest →
the four agent tools with Cal.com booking → call list + transcript → instant owner SMS/email on
booking/lead. DoD: onboard one real client, a real call gets answered and booked, owner gets a text.

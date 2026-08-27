# FrontDesk AI

An AI voice receptionist for local service businesses. A caller dials a business's number, an AI
answers, and it books the appointment against the real calendar, takes a message, or hands the
call to a person — then the owner sees exactly what it caught. Multi-tenant: one operator runs
many businesses, each with its own agent, phone number, calendar, call log and billing.

Live at **[frontdeskai.company](https://frontdeskai.company)**.

## How a call actually works

The website is the easy half. The phone call is the product.

```
caller
  └─▶ Retell AI  ── speech recognition · endpointing · LLM turn · text-to-speech
        │           (owns the sub-second budget; runs gpt-4.1-mini + 11labs voice)
        │
        ├─▶ POST /api/agent-tools/check-availability   real free/busy, mid-call
        ├─▶ POST /api/agent-tools/book                 reserve the slot, atomically
        ├─▶ POST /api/agent-tools/cancel               find by phone, free the slot
        ├─▶ POST /api/agent-tools/transfer             enforce the handoff rules
        └─▶ POST /api/agent-tools/message              capture the lead
              │
              └─▶ this app ──▶ Neon Postgres · Google/Microsoft/Cal.com · Twilio SMS
                          └──▶ outbound webhooks: call.completed, lead.created,
                               appointment.booked
```

Retell runs the realtime loop. **This codebase is what the agent calls while the caller is still
on the line** — the model has no idea whether Thursday at 2:00 is free, so it asks, and the answer
has to come back inside the conversation's latency budget. That round trip is the product.

Three things are load-bearing and non-obvious:

- **Per-tenant prompt compilation.** `lib/agent-publish.ts` compiles each business's hours,
  services, knowledge and handoff mode into a `general_prompt` and republishes it to that tenant's
  own Retell LLM, idempotently. Settings changes must go through the portal actions that call it —
  a raw DB write leaves the live agent reciting the old prompt.
- **Decisions live in code, not in the prompt.** The transfer route re-checks the handoff setting
  server-side because a prompt is a request and this is a decision. `check-availability` returns an
  explicit `status` and a `say` instruction rather than a bare empty list, because "booked solid"
  and "never set opening hours" looked identical to the model and it told callers a wide-open week
  was full.
- **Telephony reality.** Transfers classify voicemail and fail back inside a ~25s window, because
  a mobile voicemail box answering looks exactly like a person answering. Silence detection ends
  butt-dials instead of holding the line open for ten minutes.

Anthropic is **not** in the live call. It runs the nightly fleet in `lib/agents/`: QA grading every
call, drafting prompt improvements for human approval, transcript extraction, knowledge ingest,
and the operator copilot.

## Stack
**Voice:** Retell AI (telephony, ASR, TTS, realtime LLM) · **App:** Next.js 16 App Router ·
React 19 · TypeScript · Tailwind v4 + shadcn (Base UI) · **Data:** Drizzle + Neon Postgres ·
**Auth:** Clerk · **Scheduling:** Google Calendar · Microsoft · Cal.com ·
**Messaging:** Twilio (A2P-registered) + Resend · **Billing:** Stripe ·
**Background agents:** Anthropic.

## Setup

**Prerequisites:** Node 22+ and Postgres. **Local dev needs no cloud accounts:** a local
Postgres works, and [Clerk](https://clerk.com) auth runs in **keyless mode** (a temporary dev
instance is auto-provisioned — no keys needed). For production, point `DATABASE_URL` at
[Neon](https://neon.tech) and add real Clerk keys.

1. **Install**
   ```bash
   npm install
   ```
2. **Configure env** — copy the example and fill in at least `DATABASE_URL` and the two Clerk keys:
   ```bash
   cp .env.example .env.local
   ```
   See `.env.example` for the full list (Retell, Cal.com, Resend, Twilio, Stripe, Anthropic are
   needed in later phases; the **Settings → Connections** page shows what's configured).
3. **Push the schema** to your Neon database:
   ```bash
   npm run db:push
   ```
4. **Run**
   ```bash
   npm run dev        # http://localhost:3300
   ```
   Sign up → you become the operator → land on the empty dashboard.

## Scripts
| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on port **3300** |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:push` | Push schema to the database (dev) |
| `npm run db:migrate` | Apply generated migrations |
| `npm run db:studio` | Drizzle Studio |

## Structure
```
src/
  app/
    (auth)/            sign-in, sign-up
    (dashboard)/       operator shell: clients, review, settings
    (legal)/           terms, privacy, SMS consent, contact
    portal/            what a business owner sees — calls, bookings, leads, settings
    api/
      agent-tools/     what the live AI calls mid-conversation
      webhooks/        inbound: retell, twilio, stripe
      cron/            nightly + daily jobs (see vercel.json)
      calendar/        Google + Microsoft OAuth connect/callback
  components/          app shell + reusable UI (ui/ = shadcn/Base UI)
  config/              app constants + nav, pricing plans, support contact
  db/                  Drizzle schema + client
  lib/
    agents/            the Anthropic fleet: qa, improve, extract, ingest, copilot
    actions/           server actions, one module per surface
    data/              tenant-scoped queries — every one takes a client_id
    *.ts               retell, agent-publish, booking, notifier, auth-guard, env
  proxy.ts             Clerk auth gate (Next 16 "proxy" = middleware)
drizzle/               generated SQL migrations
```

## Conventions (see `AGENTS.md`)
- Money is **integer cents**. Tenant queries **always scope by `client_id`/`org_id`** via
  `src/lib/auth-guard.ts`. Vendor SDKs live **only** behind `src/lib/*`. Webhooks are idempotent.
- Middleware is **`src/proxy.ts`** (Next 16). UI uses Base UI's **`render` prop**, not `asChild`.
- A `"use server"` module may export **only async functions** — pure helpers belong in a plain
  module beside it, or the build fails with "Server Actions must be async functions".
- Anything on a call path (`api/agent-tools/*`, `api/webhooks/retell`) does slow work in
  `after()`, never inline. A caller must never hear dead air because a third party is slow.

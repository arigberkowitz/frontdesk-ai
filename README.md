# FrontDesk AI

AI voice receptionist platform for local service businesses, built on **Retell AI**.
A multi-tenant agency dashboard: one operator manages many client businesses, each with its
own AI receptionist, phone number, calendar, call logs, and billing. We sell the outcome —
_"your phone is always answered, calls get booked 24/7, and you see exactly what it caught."_

The product spec is the RingPilot PRD (product renamed FrontDesk AI). See **`PROGRESS.md`** for
phase status and **`DECISIONS.md`** for choices/deviations.

> **Status: Phase 0 (Foundation) complete.** Log in → empty dashboard. Onboarding, calls, and
> booking arrive in Phase 1.

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind v4 + shadcn (Base UI) · Drizzle + Neon Postgres ·
Clerk auth · Retell · Cal.com · Resend + Twilio · Stripe · Anthropic.

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
    (dashboard)/       operator shell + dashboard, clients, review, settings
  components/          app shell + reusable UI (ui/ = shadcn/Base UI)
  config/              app constants + nav, pricing plans
  db/                  Drizzle schema + client
  lib/                 services: retell, notifier, booking, auth-guard, env, logger, format
  proxy.ts            Clerk auth gate (Next 16 "proxy" = middleware)
drizzle/               generated SQL migrations
```

## Conventions (see `AGENTS.md`)
- Money is **integer cents**. Tenant queries **always scope by `client_id`/`org_id`** via
  `src/lib/auth-guard.ts`. Vendor SDKs live **only** behind `src/lib/*`. Webhooks are idempotent.
- Middleware is **`src/proxy.ts`** (Next 16). UI uses Base UI's **`render` prop**, not `asChild`.

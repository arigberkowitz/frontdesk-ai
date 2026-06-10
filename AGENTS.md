<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# FrontDesk AI — project conventions

FrontDesk AI is a **multi-tenant agency platform**: one operator manages many client
businesses, each with its own AI voice receptionist (built on **Retell AI**). The
full spec is the RingPilot PRD (the product was renamed FrontDesk AI). Source of
truth for *what* to build: the PRD. Source of truth for *decisions/deviations*:
`DECISIONS.md`. Per-phase status: `PROGRESS.md`. **Build in the PRD §15 phase order.**

## Stack
- Next.js 16.2.7 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4
- shadcn/ui **base-nova** style — built on **Base UI (`@base-ui/react`)**, not Radix
- Drizzle ORM + Neon Postgres (HTTP driver) · Clerk auth · Retell · Cal.com ·
  Resend (email) · Twilio (SMS) · Stripe (billing) · Anthropic (onboarding scrape)

## Gotchas that differ from training data
- **Middleware is `src/proxy.ts`**, not `middleware.ts` (Next 16 rename). Clerk lives there.
- **Base UI uses a `render` prop, not Radix `asChild`.** When a `Button` renders a non-`<button>`
  (e.g. a `Link`), set **`nativeButton={false}`**: `<Button render={<Link href=… />} nativeButton={false}>`
  — otherwise Base UI warns and a11y/form semantics break. Tooltip uses `delay`, not `delayDuration`.
  Read the actual component in `src/components/ui/` before use.
- **Request APIs are async**: `await auth()`, `await params`, `await cookies()`.
- DB is **postgres-js over TCP** (`src/db/index.ts`) — local Postgres in dev, Neon in prod
  (pooled, `?sslmode=require`); supports transactions. Dev auth runs in **Clerk keyless mode**.

## Conventions
- **Money is integer cents** everywhere (columns suffixed `_cents`; format with `formatCurrencyCents`).
- **Tenant isolation is mandatory** (§12): every tenant query scopes by `client_id`/`org_id`.
  Go through `src/lib/auth-guard.ts` (`requireOperator`, `getCurrentDbUser`, `assertClientAccess`) —
  never trust the UI alone.
- **All third-party SDKs live behind a `src/lib/*` service** (`retell`, `notifier`, `booking`, `db`).
  Don't import vendor SDKs elsewhere. Server-only modules import `"server-only"`.
- Webhook handlers must be **idempotent** (dedupe via `webhook_events`, unique `(source, external_id)`).
- Secrets are server-only; integrations **degrade gracefully** when keys are unset (`integrations.*()` guards).

## Commands
`npm run dev` (port 3300) · `build` · `typecheck` · `lint` ·
`db:generate` / `db:migrate` / `db:push` / `db:studio`

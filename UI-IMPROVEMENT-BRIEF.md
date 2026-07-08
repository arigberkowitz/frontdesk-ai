# FrontDesk AI — UI Improvement Brief (handoff for a new session)

You are improving the UI of an existing, working product. Make it more beautiful and premium **through craft and restraint** — hierarchy, typography, spacing, depth — **not** gradients, glow, or effects. Slop (default-startup gradients, decoration without hierarchy, untouched component defaults) is the thing to avoid.

## The product
FrontDesk AI — a multi-tenant SaaS: an AI phone receptionist for local service businesses. Three surfaces:
- **Operator dashboard** (`src/app/(dashboard)/*`) — the agency admin managing many client businesses.
- **Client portal** (`src/app/portal/*`) — what each business owner sees (their own data).
- **Public landing** (`src/app/page.tsx` → `src/components/landing-page.tsx`) and auth pages.

## Repo + stack
- Location: `~/frontdesk-ai` (Next.js 16 App Router, React 19, TypeScript, Tailwind v4).
- UI: shadcn/ui "base-nova" built on Base UI (`@base-ui/react`) — uses the `render` prop, not Radix `asChild`.
- Data: Drizzle ORM + Neon Postgres. Auth: Clerk. Integrations: Retell (voice), Cal.com/Google (calendar), Resend (email), Anthropic, Stripe.
- Deploy: Vercel auto-builds on push to `main`.

## The design system (match this — it's deliberate)
- **Type:** headings and big numbers use the Fraunces serif via the `font-heading` class. Body is Geist sans.
- **Color:** brand indigo `#6366f1`, success/value emerald `#10b981`, supporting sky `#0ea5e9`, amber `#f59e0b`.
- **Accent chips:** `bg-{color}-500/10 text-{color}-600 dark:text-{color}-400`. Semantics: money/value = emerald, calls = sky, people/messages/after-hours = indigo, margin/warnings = amber.
- **Surfaces:** the shadcn `Card` component (has a soft resting shadow). Page background is a faint neutral tint so cards lift off it.
- **Motion (CSS only, in `globals.css`):** `.fd-stagger` (staggered fade-up for grids), `.fd-lift` (hover lift), `.fd-fade-up`. All disabled under `prefers-reduced-motion`.
- **Already built:** dark mode (next-themes toggle in the top bars), ⌘K command palette, count-up numbers (`components/count-up.tsx`), sparklines (`components/charts/sparkline.tsx`), Recharts charts with a shared theme (`components/charts/theme.ts`).

## Hard constraints
1. **Do NOT touch the sign-in page** — `src/app/sign-in/**` and `src/components/ui/sign-in-flow-1.tsx` (a WebGL animated flow). The owner loves it as-is.
2. **Dark mode must keep working.** Never hardcode grays (`text-gray-*`, `text-[#...]`, bare `bg-white`) on text/surfaces — use tokens (`text-muted-foreground`, `text-foreground`, `bg-card`, `bg-muted`) or `dark:` variants. (Inline `style={{background:"#6366f1"}}` on brand logo chips is fine.)
3. **Keep it green:** before every commit run `npx tsc --noEmit` and `npx eslint src` — both must pass with 0 errors.
4. **Prefer token-level changes.** Editing `src/components/ui/card.tsx` or `src/app/globals.css` elevates the whole app at once — safer and more consistent than per-file tweaks.
5. **No new heavy dependencies.** CSS + the existing libs only.
6. Note: `next build` can't run offline in some sandboxes (it fetches Google Fonts). Rely on `tsc` + `eslint`; Vercel runs the real build on push.

## Workflow the owner likes
- For any noticeable visual change, **show a mockup/preview first and get approval** before applying (the owner explicitly prefers "show me first"). Use an inline HTML/SVG mockup.
- Commit in small, verified steps. Deploy = `cd ~/frontdesk-ai && git push` (owner runs this; Vercel redeploys).

## High-value opportunities to consider
- Dashboard hero + section rhythm; consistent empty/loading/error states.
- Portal overview column pacing (it stacks several cards — keep it from feeling repetitive).
- A refined type scale (heading sizes, number sizes) so hierarchy reads cleanly.
- The landing page (`landing-page.tsx`) — make it genuinely striking while on-brand.
- Chart styling, micro-interactions, and mobile/responsive polish.
- Iconography and spacing consistency (4/8/12/16/24 rhythm).

Start by reading `src/app/globals.css`, `src/components/ui/card.tsx`, the dashboard page, and one portal page to absorb the current look, then propose a direction with a preview.

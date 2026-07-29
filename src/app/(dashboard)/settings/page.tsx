import type { Metadata } from "next";
import { CheckCircle2, CircleDashed, ExternalLink } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResyncCard } from "@/components/settings/resync-card";
import { SignupsCard } from "@/components/settings/signups-card";
import { requireOperator } from "@/lib/auth-guard";
import { env, integrations } from "@/lib/env";

export const metadata: Metadata = { title: "Settings" };

/**
 * Connection status (server component — reads server env directly). Gives the
 * operator a single place to see which integrations are configured and, when
 * they aren't, exactly what to set and where to get it.
 */
type Connection = {
  name: string;
  ok: boolean;
  required?: boolean;
  description: string;
  env: string[];
  docs?: string;
};

function connections(): Connection[] {
  const clerkConfigured = Boolean(
    process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  return [
    {
      name: "Database — Neon Postgres",
      ok: Boolean(env.DATABASE_URL),
      required: true,
      description: "Stores every client, call, appointment, and lead.",
      env: ["DATABASE_URL"],
      docs: "https://neon.tech/docs/connect/connect-from-any-app",
    },
    {
      name: "Auth — Clerk",
      ok: clerkConfigured,
      required: true,
      description: "Operator sign-in and client-portal invites.",
      env: ["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"],
      docs: "https://clerk.com/docs/quickstarts/nextjs",
    },
    {
      name: "Voice — Retell",
      ok: integrations.retell(),
      description: "Powers the AI receptionist — provisions agents, voices, and phone numbers.",
      env: ["RETELL_API_KEY"],
      docs: "https://docs.retellai.com",
    },
    {
      name: "Booking — Cal.com",
      ok: integrations.calcom(),
      description: "Lets the agent check availability and book appointments live on a call.",
      env: ["CALCOM_API_KEY", "CALCOM_EVENT_TYPE_ID"],
      docs: "https://cal.com/docs/api-reference",
    },
    {
      name: "Email — Resend",
      ok: integrations.resend(),
      description: "Transactional email — owner alerts and portal notifications.",
      env: ["RESEND_API_KEY"],
      docs: "https://resend.com/docs/introduction",
    },
    {
      name: "SMS — Twilio",
      ok: integrations.twilio(),
      description: "Texts the business owner the moment a booking or lead comes in.",
      env: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
      docs: "https://www.twilio.com/docs/messaging/quickstart",
    },
    {
      name: "AI — Anthropic",
      ok: integrations.anthropic(),
      description:
        "Powers onboarding drafts and the whole agent layer: nightly improvement, QA grading, post-call extraction, and the portal copilot.",
      env: ["ANTHROPIC_API_KEY"],
      docs: "https://docs.claude.com/en/api/getting-started",
    },
    {
      name: "Error monitoring — Sentry",
      ok: Boolean(process.env.SENTRY_DSN),
      description:
        "Surfaces webhook and agent-run failures the moment they happen, instead of leaving them buried in function logs.",
      env: ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"],
      docs: "https://docs.sentry.io/platforms/javascript/guides/nextjs/",
    },
    {
      name: "Scheduled agents — Cron",
      ok: Boolean(env.CRON_SECRET),
      description:
        "Authorizes the nightly QA, self-improvement, recovery, and digest jobs. Without it every scheduled agent is disabled.",
      env: ["CRON_SECRET"],
      docs: "https://vercel.com/docs/cron-jobs",
    },
    {
      name: "Billing — Stripe",
      ok: integrations.stripe(),
      description: "Setup fees and subscriptions, with webhooks keeping plans in sync.",
      env: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      docs: "https://stripe.com/docs/keys",
    },
  ];
}

function ConnectionRow({ c }: { c: Connection }) {
  return (
    <li className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        {c.ok ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        )}
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{c.name}</span>
          <p className="text-sm text-muted-foreground">{c.description}</p>
          {!c.ok ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-xs text-muted-foreground">Set</span>
              {c.env.map((key) => (
                <code
                  key={key}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
                >
                  {key}
                </code>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-8 sm:pl-0">
        {c.required ? <Badge variant="secondary">Required</Badge> : null}
        <Badge variant={c.ok ? "default" : "outline"}>{c.ok ? "Connected" : "Not set"}</Badge>
        {!c.ok && c.docs ? (
          <a
            href={c.docs}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Setup guide
            <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

export default async function SettingsPage() {
  const items = connections();
  const required = items.filter((c) => c.required);
  const optional = items.filter((c) => !c.required);
  const liveCount = optional.filter((c) => c.ok).length;

  const user = await requireOperator();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, user.orgId),
    columns: { kind: true, autoAttachSignups: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Integrations and workspace configuration." />

      {org?.kind === "agency" ? (
        <>
          <SignupsCard enabled={org.autoAttachSignups} />
          <ResyncCard />
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Required</CardTitle>
          <CardDescription>
            The app won&apos;t run without these. Set them in your environment (
            <code className="font-mono text-xs">.env.local</code> in dev).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {required.map((c) => (
              <ConnectionRow key={c.name} c={c} />
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            The services that power calls, booking, and alerts — {liveCount} of {optional.length}{" "}
            connected. Each degrades gracefully until its keys are set.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {optional.map((c) => (
              <ConnectionRow key={c.name} c={c} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

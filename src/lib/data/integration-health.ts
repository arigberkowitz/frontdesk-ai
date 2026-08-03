import "server-only";
import { env } from "@/lib/env";

/**
 * Which integrations are actually wired up in THIS deployment.
 *
 * Written after an afternoon spent chasing inbound STOP messages that failed
 * with a generic 401. The cause was a single missing environment variable, and
 * nothing anywhere in the product said so — every integration in this app fails
 * closed and quiet, which is right for safety and terrible for diagnosis.
 *
 * Every check reports only whether a value is PRESENT, never what it is. The
 * one exception is APP_URL, which is a public hostname and the thing most
 * likely to be wrong after a domain move — a webhook signed against one host
 * and verified against another is exactly how we lost that afternoon.
 */

export interface HealthItem {
  key: string;
  label: string;
  ok: boolean;
  /** What silently stops working when this isn't set. */
  breaks: string;
  /** Names of the missing variables — never their values. */
  missing: string[];
}

function check(
  key: string,
  label: string,
  breaks: string,
  vars: Record<string, string>,
): HealthItem {
  const missing = Object.entries(vars)
    .filter(([, v]) => !v?.trim())
    .map(([name]) => name);
  return { key, label, ok: missing.length === 0, breaks, missing };
}

export function integrationHealth(): { items: HealthItem[]; appUrl: string; failing: number } {
  const items: HealthItem[] = [
    check("retell", "Retell", "No phone numbers, no agents, no live calls.", {
      RETELL_API_KEY: env.RETELL_API_KEY,
    }),
    // Deliberately itemised rather than one boolean. `integrations.twilio()`
    // ANDs these three together, so a missing auth token and a missing from
    // number look identical — which is precisely what hid the STOP failure.
    check("twilio", "Twilio", "Outbound SMS, and inbound STOP/HELP handling.", {
      TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
      TWILIO_FROM_NUMBER: env.TWILIO_FROM_NUMBER,
    }),
    check("resend", "Resend", "Every outbound email — alerts, digests, quiet-line warnings.", {
      RESEND_API_KEY: env.RESEND_API_KEY,
    }),
    check("google", "Google Calendar", "Businesses can't connect a Google calendar.", {
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    }),
    check("microsoft", "Outlook / 365", "Businesses can't connect an Outlook calendar.", {
      MS_CLIENT_ID: env.MS_CLIENT_ID,
      MS_CLIENT_SECRET: env.MS_CLIENT_SECRET,
    }),
    check("stripe", "Stripe", "Billing and subscriptions.", {
      STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    }),
    check("anthropic", "Anthropic", "Call summaries, QA review, nightly improvements.", {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    }),
    // Not a third-party key, but the same failure shape: unset means the cron
    // endpoints 401 every scheduler hit and simply never run.
    check("cron", "Cron secret", "Digests, weekly reports, and the quiet-line alert never run.", {
      CRON_SECRET: env.CRON_SECRET,
    }),
    check("agentTools", "Agent-tools secret", "The agent can't book, cancel, or take messages.", {
      AGENT_TOOLS_SECRET: env.AGENT_TOOLS_SECRET,
    }),
  ];

  return {
    items,
    appUrl: env.APP_URL,
    failing: items.filter((i) => !i.ok).length,
  };
}

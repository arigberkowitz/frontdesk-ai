import "server-only";

/**
 * Centralized, server-only access to environment variables (§13).
 *
 * We intentionally do NOT throw at module load for missing keys — the app must
 * boot for local dev and CI even when optional integrations are unconfigured.
 * Each integration exposes a `has*()` guard so callers can degrade gracefully
 * (e.g. the Notifier no-ops without Resend/Twilio keys instead of crashing).
 *
 * `DATABASE_URL` is the one hard requirement for any DB operation; the db client
 * (src/db/index.ts) throws a clear error only when it is actually used unset.
 */
export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  RETELL_API_KEY: process.env.RETELL_API_KEY ?? "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
  RESEND_FROM: process.env.RESEND_FROM ?? "FrontDesk AI <notifications@frontdesk.ai>",
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? "",
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? "",
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER ?? "",
  CALCOM_API_KEY: process.env.CALCOM_API_KEY ?? "",
  CALCOM_EVENT_TYPE_ID: process.env.CALCOM_EVENT_TYPE_ID ?? "",
  // Encryption key for per-client calendar credentials stored at rest.
  CREDENTIALS_SECRET: process.env.CREDENTIALS_SECRET ?? "",
  // Google Calendar OAuth app (per-business one-click calendar connect).
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
  // Microsoft (Azure AD) OAuth app — one-click Outlook / Microsoft 365 connect.
  MS_CLIENT_ID: process.env.MS_CLIENT_ID ?? "",
  MS_CLIENT_SECRET: process.env.MS_CLIENT_SECRET ?? "",
  // Public number for the sales demo agent (§11 screen 9).
  DEMO_PHONE_NUMBER: process.env.DEMO_PHONE_NUMBER ?? "",
  // Public base URL for webhook + agent-tool callbacks (baked into Retell at
  // provision time). Prefer an explicit APP_URL; on Vercel, fall back to the
  // stable production domain it injects; otherwise local dev.
  APP_URL:
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3300"),
  // Shared secret the agent-tool callbacks check (baked into Retell tool URLs).
  // Use `||` so an empty RETELL_API_KEY doesn't become the secret. The dev
  // default NEVER applies in production — a guessable public string as the
  // only auth on booking/cancel/message endpoints would be an open door;
  // authenticateAgentTool rejects an empty secret, so prod without env vars
  // fails closed instead.
  // NOT the Retell API key. It used to fall back to it, which meant the key
  // that can provision numbers and read every tenant's transcripts was baked
  // into agent tool URLs as ?token=… — visible in Retell's dashboard and in
  // every access log. Unset in production now fails closed instead.
  AGENT_TOOLS_SECRET:
    process.env.AGENT_TOOLS_SECRET ||
    (process.env.NODE_ENV === "production" ? "" : "dev-agent-tools-secret"),
  // Secret protecting the digest cron endpoint (digests disabled until set).
  CRON_SECRET: process.env.CRON_SECRET ?? "",
  // The comp code: hand it to a business you know and they get the full
  // product free, indefinitely, with no card and no approval step. Deliberately
  // not in the database — nothing that grants free access forever should sit in
  // a table that gets exported, backed up, or rendered onto a page by mistake.
  // Unset means no such code exists, and the check below fails closed.
  COMP_ACCESS_CODE: process.env.COMP_ACCESS_CODE ?? "",
} as const;

/** Runtime guards — true only when an integration has the keys it needs. */
export const integrations = {
  retell: () => Boolean(env.RETELL_API_KEY),
  anthropic: () => Boolean(env.ANTHROPIC_API_KEY),
  stripe: () => Boolean(env.STRIPE_SECRET_KEY),
  resend: () => Boolean(env.RESEND_API_KEY),
  twilio: () =>
    Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER),
  calcom: () => Boolean(env.CALCOM_API_KEY),
  google: () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  microsoft: () => Boolean(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET),
} as const;

/** Absolute URL for webhook targets (Retell/Stripe call back into us). */
export function webhookUrl(path: string): string {
  const base = env.APP_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

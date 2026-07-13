import * as Sentry from "@sentry/nextjs";

/**
 * Server-side error monitoring. No-ops entirely until SENTRY_DSN is set, so
 * local dev and unconfigured deploys behave exactly as before. Once set,
 * webhook failures and agent-run crashes surface in Sentry instead of dying
 * silently in function logs.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  // Init on the Node runtime only — the app's server work (webhooks, crons,
  // agents) all runs there, and keeping Sentry out of the edge bundle avoids
  // middleware bundling surprises.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      enableLogs: true,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;

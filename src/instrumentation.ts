import * as Sentry from "@sentry/nextjs";

/**
 * Server-side error monitoring. No-ops entirely until SENTRY_DSN is set, so
 * local dev and unconfigured deploys behave exactly as before. Once set,
 * webhook failures and agent-run crashes surface in Sentry instead of dying
 * silently in function logs.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    enableLogs: true,
  });
}

export const onRequestError = Sentry.captureRequestError;

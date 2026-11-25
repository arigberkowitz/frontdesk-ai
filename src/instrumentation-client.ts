import { initBotId } from "botid/client/core";
import * as Sentry from "@sentry/nextjs";
import { BOTID_PROTECTED_ROUTES } from "@/lib/botid-protect";

// Attach BotID challenge headers to public form POSTs. Must match the
// paths and checkLevel used by checkPublicBot() on the server. See
// src/lib/botid-protect.ts for what is (and isn't) on this list.
initBotId({ protect: BOTID_PROTECTED_ROUTES });

/** Client-side error monitoring — no-op until NEXT_PUBLIC_SENTRY_DSN is set. */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

import "server-only";
import { env, integrations } from "@/lib/env";
import { SUPPORT_EMAIL } from "@/config/contact";
import { logger } from "@/lib/logger";
import { tollfreeStore } from "@/lib/data/tollfree";
import { twilioTollfreeApi } from "./twilio-api";
import type { TollfreeDeps } from "./service";

/** Production wiring. Disabled unless TOLLFREE_SMS_ENABLED=on and Twilio is configured. */
export function liveTollfreeDeps(): TollfreeDeps {
  return {
    enabled: env.TOLLFREE_SMS_ENABLED && integrations.twilio(),
    api: twilioTollfreeApi(),
    store: tollfreeStore,
    appUrl: env.APP_URL,
    notificationEmail: SUPPORT_EMAIL,
    log: (event, detail) => logger.info(event, detail),
  };
}

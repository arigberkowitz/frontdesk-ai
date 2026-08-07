import "server-only";
import { db } from "@/db";
import { smsConsents } from "@/db/schema";
import { logger } from "./../logger";

/**
 * The exact consent script version currently in force. This string is the
 * contract between three places that must not drift: the prompt rule that
 * makes the agent ask (src/lib/prompt.ts), the published description on
 * /sms-consent, and the A2P campaign registered with the carriers. Bump it if
 * the ask ever changes, so old rows keep saying what was actually agreed to.
 */
export const CONSENT_WORDING_VERSION = "booking-v1";

/**
 * Write the receipt for a "yes, text me".
 *
 * Best-effort by design: the booking has already succeeded and the caller is
 * being told so — a logging hiccup here must not unwind any of that. A missed
 * receipt is strictly better than a failed booking, and the call recording
 * still exists as the deeper proof.
 */
export async function recordSmsConsent(input: {
  clientId: string;
  phone: string;
  callId?: string | null;
}): Promise<void> {
  try {
    await db.insert(smsConsents).values({
      clientId: input.clientId,
      phone: input.phone,
      callId: input.callId ?? null,
      wording: CONSENT_WORDING_VERSION,
    });
  } catch (err) {
    logger.error("sms_consent.record_failed", {
      clientId: input.clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

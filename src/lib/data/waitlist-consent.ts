import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { smsConsents } from "@/db/schema";
import { normalizePhone } from "./sms-optouts";
import { logger } from "@/lib/logger";

/**
 * Consent for waitlist texts ("a slot opened — want it?").
 *
 * The waitlist tool is only to be called after the customer says yes to "want
 * a text if something opens up?" (see its tool description), so joining IS the
 * consent. Until now that yes was never written down, and the offer texts went
 * out gated only by STOP. Now joining writes an `sms_consents` row with its own
 * wording version, and offers only go to numbers holding one — failing closed
 * if the lookup errors.
 *
 * Kept separate from the booking consent ("booking-v1"): agreeing to a booking
 * confirmation is not agreeing to be offered other appointments later.
 */
export const WAITLIST_CONSENT_WORDING = "waitlist-v1";

/** Best-effort receipt of the "yes, text me if something opens". */
export async function recordWaitlistConsent(input: {
  clientId: string;
  phone: string;
  callId?: string | null;
}): Promise<void> {
  try {
    await db.insert(smsConsents).values({
      clientId: input.clientId,
      phone: input.phone,
      callId: input.callId ?? null,
      wording: WAITLIST_CONSENT_WORDING,
    });
  } catch (err) {
    logger.error("waitlist_consent.record_failed", {
      clientId: input.clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Numbers (normalized digits) that agreed to waitlist texts from this business.
 * Fails CLOSED: on any error, nobody is consented and nothing is sent.
 */
export async function getWaitlistConsentedPhones(clientId: string): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ phone: smsConsents.phone })
      .from(smsConsents)
      .where(and(eq(smsConsents.clientId, clientId), eq(smsConsents.wording, WAITLIST_CONSENT_WORDING)));
    const out = new Set<string>();
    for (const r of rows) {
      const key = normalizePhone(r.phone ?? "");
      if (key) out.add(key);
    }
    return out;
  } catch (err) {
    logger.error("waitlist_consent.lookup_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Set();
  }
}

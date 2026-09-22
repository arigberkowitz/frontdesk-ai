import "server-only";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, subscriptions } from "@/db/schema";
import { getRetellClient } from "@/lib/retell";
import { notifier } from "@/lib/notifier";
import { env, integrations } from "@/lib/env";
import { formatPhone } from "@/lib/format";
import { logger } from "@/lib/logger";

/**
 * A free trial that ends unpaid gives its phone number back.
 *
 * Every activated business holds a real number, and the vendor bills for it
 * monthly whether or not anyone ever picks a plan. Signups are free and
 * instant now, so without this a hundred people trying the product is a
 * hundred numbers on the operator's card forever.
 *
 * Grace: three days past the trial's end. The Overview banner has counted
 * down for a week, and the number is the one thing worth a short pause —
 * releasing it at midnight on day 21 would punish the owner who meant to
 * pay on day 22. After release the business is paused (nothing answers), the
 * owner gets one email, and choosing a plan later activates a fresh number.
 */
export const LAPSE_GRACE_DAYS = 3;

export interface TrialLapseResult {
  released: number;
  failed: number;
}

export async function runTrialLapse(now = new Date()): Promise<TrialLapseResult> {
  const cutoff = new Date(now.getTime() - LAPSE_GRACE_DAYS * 24 * 60 * 60 * 1000);

  // Trial ended past the grace, still holding a number, not comped, and no
  // subscription that's active or in a Stripe trial.
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      ownerEmail: clients.ownerEmail,
      phone: clients.retellPhoneNumber,
      setupFlags: clients.setupFlags,
      subStatus: subscriptions.status,
    })
    .from(clients)
    .leftJoin(subscriptions, eq(subscriptions.clientId, clients.id))
    .where(
      and(
        isNull(clients.deletedAt),
        eq(clients.status, "trial"),
        isNotNull(clients.trialEndsAt),
        lt(clients.trialEndsAt, cutoff),
        isNotNull(clients.retellPhoneNumber),
        sql`coalesce(${subscriptions.status}::text, '') not in ('active', 'trialing')`,
      ),
    );

  let released = 0;
  let failed = 0;
  for (const c of rows) {
    if (c.setupFlags?.comped) continue;
    const phone = c.phone!;
    try {
      if (integrations.retell()) {
        try {
          await getRetellClient().phoneNumber.delete(phone);
        } catch (err) {
          // Already gone at the vendor is the same outcome as released.
          const msg = err instanceof Error ? err.message : String(err);
          if (!/404|not found/i.test(msg)) throw err;
        }
      }
      await db
        .update(clients)
        .set({ retellPhoneNumber: null, status: "paused" })
        .where(eq(clients.id, c.id));
      released += 1;
      logger.info("trial.lapsed.number_released", { clientId: c.id, phone });

      const to = c.ownerEmail?.trim();
      if (to && integrations.resend()) {
        const plans = `${env.APP_URL.replace(/\/$/, "")}/portal/guidelines#plans`;
        await notifier.sendEmail({
          to,
          subject: `Your free trial of FrontDesk AI has ended`,
          text:
            `Hi — your free trial for ${c.name} ended a few days ago, so we've switched your AI receptionist off and released its number, ${formatPhone(phone)}. ` +
            `Nothing else has changed: your services, hours, answers, calls and bookings are all still there.\n\n` +
            `Pick a plan and it's back on within a minute with a new number: ${plans}\n\n` +
            `If you forwarded your business line to ${formatPhone(phone)}, dial *73 from that phone to undo it, or your callers will hear a disconnected number.\n\n` +
            `Questions? Just reply to this email.`,
          html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
  <h2 style="margin:0 0 12px;font-size:18px">Your free trial has ended</h2>
  <p style="margin:0 0 10px;font-size:15px">Your trial for <strong>${c.name.replace(/[<>&]/g, "")}</strong> ended a few days ago, so we've switched your AI receptionist off and released its number, <strong>${formatPhone(phone)}</strong>.</p>
  <p style="margin:0 0 10px;font-size:15px">Nothing else has changed — your services, hours, answers, calls and bookings are all still there.</p>
  <p style="margin:0 0 10px;font-size:15px"><a href="${plans}">Pick a plan</a> and it's back on within a minute, with a new number.</p>
  <p style="margin:0 0 10px;font-size:15px;color:#b45309">If you forwarded your business line to ${formatPhone(phone)}, dial <strong>*73</strong> from that phone to undo it — otherwise your callers will hear a disconnected number.</p>
  <p style="color:#999;font-size:12px;margin-top:18px">Questions? Just reply to this email. · FrontDesk AI</p>
</div>`,
        });
      }
    } catch (err) {
      failed += 1;
      logger.error("trial.lapsed.release_failed", {
        clientId: c.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { released, failed };
}

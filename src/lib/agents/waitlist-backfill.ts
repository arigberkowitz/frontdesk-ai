import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { services as servicesTable, type Client } from "@/db/schema";
import { createReminder } from "@/lib/data/reminders";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { listWaiting, markOffered } from "@/lib/data/waitlist";
import {
  chooseOffers,
  describeOpening,
  waitlistOfferBody,
  type Opening,
  type WaitlistCandidate,
} from "@/lib/waitlist";
import { notifier } from "@/lib/notifier";
import { logger } from "@/lib/logger";

/**
 * A slot just opened. Tell the people who wanted it.
 *
 * Called the moment an appointment is cancelled, from both the AI's cancel
 * tool and the portal's manual cancel — a slot is equally free either way, and
 * wiring only one of them would make the feature work half the time for
 * reasons no owner could guess.
 *
 * Never awaited by its callers: one of them is a live phone call. A slow
 * carrier must not become dead air, and a text that fails must not turn a
 * successful cancellation into an error the caller hears about.
 */
export async function offerFreedSlot(
  client: Client,
  opening: Opening,
  now = new Date(),
): Promise<number> {
  if (!client.waitlistEnabled) return 0;

  try {
    const waiting = await listWaiting(client.id, now);
    if (waiting.length === 0) return 0;

    const candidates: WaitlistCandidate[] = waiting.map((w) => ({
      id: w.id,
      customerPhone: w.customerPhone,
      serviceId: w.serviceId,
      earliestAt: w.earliestAt,
      latestAt: w.latestAt,
      status: w.status,
      notifyCount: w.notifyCount,
      createdAt: w.createdAt,
    }));

    const chosen = chooseOffers(candidates, opening, now);
    if (chosen.length === 0) return 0;

    const service = opening.serviceId
      ? await db.query.services.findFirst({ where: eq(servicesTable.id, opening.serviceId) })
      : null;
    const when = describeOpening(opening.startAt, client.timezone);

    let sent = 0;
    for (const entry of chosen) {
      if (await isOptedOut(entry.customerPhone)) continue;
      const row = waiting.find((w) => w.id === entry.id);
      const body = waitlistOfferBody({
        businessName: client.name,
        customerName: row?.customerName ?? null,
        serviceName: service?.name ?? null,
        when,
        callbackNumber: client.retellPhoneNumber,
      });
      const result = await notifier.sendSms({ to: entry.customerPhone, body });
      // Nothing left the building, so nothing is recorded and nobody's offer
      // count is spent — they stay first in line for the next opening.
      if (result.skipped) continue;

      const failed = !result.ok;
      await createReminder(client.id, {
        appointmentId: null,
        leadId: null,
        channel: "sms",
        kind: "waitlist_offer",
        status: failed ? "failed" : "sent",
        sentAt: failed ? null : new Date(),
        error: failed ? (result.error ?? "Send failed") : null,
      });
      if (!failed) {
        await markOffered(entry.id, client.id);
        sent += 1;
      }
    }

    logger.info("waitlist.offered", {
      clientId: client.id,
      startAt: opening.startAt.toISOString(),
      offered: sent,
    });
    return sent;
  } catch (err) {
    logger.error("waitlist.offer_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

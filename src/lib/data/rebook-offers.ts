import "server-only";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { rebookOffers, reminders, type RebookOfferRow } from "@/db/schema";

/** Newest offer per appointment, for the Hours page. */
export async function latestOffersFor(
  clientId: string,
  appointmentIds: string[],
): Promise<Map<string, RebookOfferRow>> {
  const out = new Map<string, RebookOfferRow>();
  if (appointmentIds.length === 0) return out;
  const rows = await db
    .select()
    .from(rebookOffers)
    .where(and(eq(rebookOffers.clientId, clientId), inArray(rebookOffers.appointmentId, appointmentIds)))
    .orderBy(desc(rebookOffers.createdAt));
  for (const r of rows) if (!out.has(r.appointmentId)) out.set(r.appointmentId, r);
  return out;
}

/**
 * Insert an offer row. A 'sent' row is guarded by a partial unique index (one
 * live offer per appointment), so a double-click or a second tab can't text a
 * customer twice — the loser gets null.
 */
export async function insertOffer(
  values: Omit<typeof rebookOffers.$inferInsert, "id" | "createdAt" | "updatedAt">,
): Promise<RebookOfferRow | null> {
  const [row] = await db.insert(rebookOffers).values(values).onConflictDoNothing().returning();
  return row ?? null;
}

/** The offer a reply from this number is answering, if any is still open. */
export async function findOpenOfferForPhone(
  clientId: string,
  phoneKey: string,
  now: Date,
): Promise<RebookOfferRow | null> {
  const [row] = await db
    .select()
    .from(rebookOffers)
    .where(
      and(
        eq(rebookOffers.clientId, clientId),
        eq(rebookOffers.customerPhone, phoneKey),
        eq(rebookOffers.status, "sent"),
        gt(rebookOffers.expiresAt, now),
      ),
    )
    .orderBy(desc(rebookOffers.sentAt))
    .limit(1);
  return row ?? null;
}

/**
 * Move an offer from one status to another, only if it's still in `from`.
 * Returns false when someone else (a replayed webhook, a second reply) got
 * there first — the caller must then do nothing.
 */
export async function transitionOffer(
  id: string,
  from: string,
  patch: Partial<Pick<RebookOfferRow, "status" | "skipReason" | "newAppointmentId" | "respondedAt">>,
): Promise<boolean> {
  const rows = await db
    .update(rebookOffers)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(rebookOffers.id, id), eq(rebookOffers.status, from)))
    .returning({ id: rebookOffers.id });
  return rows.length > 0;
}

export async function markOfferReplied(id: string, at: Date): Promise<void> {
  await db
    .update(rebookOffers)
    .set({ respondedAt: at, updatedAt: at })
    .where(and(eq(rebookOffers.id, id), eq(rebookOffers.status, "sent")));
}

/** Offer texts sent by this business in the last 24h — the daily cap. */
export async function offersSentLastDay(clientId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rebookOffers)
    .where(and(eq(rebookOffers.clientId, clientId), sql`${rebookOffers.sentAt} > now() - interval '24 hours'`));
  return r?.n ?? 0;
}

/**
 * Did this customer receive the booking confirmation for this appointment?
 * Same rule the day-before reminder uses: a delivered confirmation (which they
 * agreed to on the call) carries permission for texts about that appointment.
 */
export async function confirmationWasSent(clientId: string, appointmentId: string): Promise<boolean> {
  const rows = await db
    .select({ id: reminders.id })
    .from(reminders)
    .where(
      and(
        eq(reminders.clientId, clientId),
        eq(reminders.appointmentId, appointmentId),
        eq(reminders.status, "sent"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

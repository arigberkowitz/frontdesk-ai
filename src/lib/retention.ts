import "server-only";
import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { clients, webhookEvents } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { logger } from "@/lib/logger";

/**
 * Retention purge — the last privacy-policy promise that was only words.
 *
 * The policy says data is kept "while the business's account is active and
 * for a reasonable period afterwards, after which [it is] deleted or
 * de-identified." Until this job, nothing deleted anything: a business that
 * churned in June would still have every caller's name, number, and full
 * call transcript sitting in the database years later. A promise about
 * deletion with no code behind it is the kind of thing that reads fine right
 * up until a regulator, a journalist, or a subpoena asks to see the code.
 *
 * What "a reasonable period" means here: 90 days. Long enough for a churned
 * business to change its mind and come back whole; short enough to defend.
 *
 * Two sweeps:
 *  1. Clients churned or soft-deleted more than 90 days ago are HARD-deleted.
 *     The schema does the heavy lifting — every tenant table (calls, leads,
 *     appointments, reminders, knowledge, …) cascades from clients. The audit
 *     log survives with client_id set null: the receipts stay, the personal
 *     data goes.
 *  2. Webhook payloads older than 90 days are nulled. Raw Stripe and Retell
 *     payloads carry transcripts, addresses, and emails; the rows themselves
 *     stay (their external_id powers webhook dedupe), but the personal data
 *     inside them ages out.
 *
 * Vendor copies (Retell recordings, Twilio message logs) are governed by
 * their own retention settings — this job removes OUR copies and pointers.
 */

export const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------ pure logic ------------------------------ */

export interface PurgeCandidate {
  status: string;
  /** When the row was soft-deleted, if it was. */
  deletedAt: Date | null;
  /** Last touch — for churned clients, roughly when they churned. */
  updatedAt: Date;
}

/**
 * Only ended relationships are ever purged: churned, or soft-deleted from the
 * operator dashboard. Active, trialing, paused, and draft businesses keep
 * their data — "paused" is a light switch, not a goodbye, and drafts belong
 * to people who may still finish signing up.
 */
export function isPurgeable(client: PurgeCandidate, now: Date): boolean {
  const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
  if (client.deletedAt) return client.deletedAt.getTime() < cutoff;
  if (client.status === "churned") return client.updatedAt.getTime() < cutoff;
  return false;
}

export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
}

/* ------------------------------ the sweep ------------------------------- */

export interface RetentionResult {
  clientsPurged: number;
  purgedNames: string[];
  webhookPayloadsCleared: number;
}

export async function runRetention(now = new Date()): Promise<RetentionResult> {
  const cutoff = retentionCutoff(now);

  // Sweep 1: ended relationships past the grace period.
  const candidates = await db
    .select({
      id: clients.id,
      name: clients.name,
      status: clients.status,
      deletedAt: clients.deletedAt,
      updatedAt: clients.updatedAt,
    })
    .from(clients)
    .where(
      or(
        and(isNotNull(clients.deletedAt), lt(clients.deletedAt, cutoff)),
        and(eq(clients.status, "churned"), lt(clients.updatedAt, cutoff)),
      ),
    );
  // Belt over braces: re-check in code so a query drift can never widen the
  // blast radius of a job whose whole action is deletion.
  const purgeable = candidates.filter((c) =>
    isPurgeable({ status: c.status, deletedAt: c.deletedAt, updatedAt: c.updatedAt }, now),
  );

  if (purgeable.length > 0) {
    await db.delete(clients).where(
      inArray(
        clients.id,
        purgeable.map((c) => c.id),
      ),
    );
  }

  // Sweep 2: age the personal data out of stored webhook payloads.
  const cleared = await db
    .update(webhookEvents)
    .set({ payload: null })
    .where(and(lt(webhookEvents.createdAt, cutoff), isNotNull(webhookEvents.payload)))
    .returning({ id: webhookEvents.id });

  const result: RetentionResult = {
    clientsPurged: purgeable.length,
    purgedNames: purgeable.map((c) => c.name),
    webhookPayloadsCleared: cleared.length,
  };

  if (result.clientsPurged > 0 || result.webhookPayloadsCleared > 0) {
    // The receipt says WHAT was purged and by which rule — without keeping any
    // of the data the purge just promised to remove.
    void audit({
      actor: "system",
      action: "retention.purged",
      detail: {
        retentionDays: RETENTION_DAYS,
        clientsPurged: result.clientsPurged,
        webhookPayloadsCleared: result.webhookPayloadsCleared,
      },
    });
  }
  logger.info("retention.ran", {
    clientsPurged: result.clientsPurged,
    webhookPayloadsCleared: result.webhookPayloadsCleared,
    cutoff: cutoff.toISOString(),
  });
  return result;
}

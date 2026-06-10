import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { webhookEvents, type WebhookEvent } from "@/db/schema";

type Source = WebhookEvent["source"];

/**
 * Idempotency ledger (§C1/§C5). Returns `{ isNew }`: if false, this (source,
 * external_id) was already received — the caller should skip reprocessing.
 */
export async function recordWebhookEvent(input: {
  source: Source;
  externalId: string;
  eventType: string;
  payload: unknown;
}): Promise<{ isNew: boolean; event?: WebhookEvent }> {
  const inserted = await db
    .insert(webhookEvents)
    .values({
      source: input.source,
      externalId: input.externalId,
      eventType: input.eventType,
      payload: input.payload,
    })
    .onConflictDoNothing({ target: [webhookEvents.source, webhookEvents.externalId] })
    .returning();

  return { isNew: inserted.length > 0, event: inserted[0] };
}

export async function markWebhookProcessed(
  source: Source,
  externalId: string,
  status: WebhookEvent["status"] = "processed",
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status, processedAt: new Date() })
    .where(and(eq(webhookEvents.source, source), eq(webhookEvents.externalId, externalId)));
}

/**
 * Remove the ledger row for an event so a later replay is treated as new and
 * reprocessed — used after a *transient* processing failure (the row would
 * otherwise short-circuit every Retell retry as a duplicate, losing the call).
 */
export async function deleteWebhookEvent(source: Source, externalId: string): Promise<void> {
  await db
    .delete(webhookEvents)
    .where(and(eq(webhookEvents.source, source), eq(webhookEvents.externalId, externalId)));
}

import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { clients, type Client } from "@/db/schema";
import { logger } from "@/lib/logger";
import { toE164 } from "@/lib/sms-number-format";

/**
 * Per-business texting numbers (clients.sms_number).
 *
 * Reads on the send/receive path never throw: a lookup failure means "use the
 * shared number / shared routing", which is exactly how things worked before
 * per-business numbers existed.
 */

/** The number this business texts FROM, or null → the shared number. */
export async function getClientSmsNumber(clientId: string): Promise<string | null> {
  if (!clientId) return null;
  try {
    const row = await db.query.clients.findFirst({
      where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
      columns: { smsNumber: true },
    });
    return row?.smsNumber ?? null;
  } catch (err) {
    logger.warn("sms.number.lookup_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** The live business that owns this texting number, if any. */
export async function findClientBySmsNumber(raw: string): Promise<Client | null> {
  const e164 = toE164(raw);
  if (!e164) return null;
  try {
    return (
      (await db.query.clients.findFirst({
        where: and(eq(clients.smsNumber, e164), isNull(clients.deletedAt)),
      })) ?? null
    );
  } catch (err) {
    logger.warn("sms.number.owner_lookup_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Another live business already using this number (for the assign form). */
export async function findOtherClientWithSmsNumber(
  e164: string,
  exceptClientId: string,
): Promise<Pick<Client, "id" | "name"> | null> {
  return (
    (await db.query.clients.findFirst({
      where: and(
        eq(clients.smsNumber, e164),
        isNull(clients.deletedAt),
        ne(clients.id, exceptClientId),
      ),
      columns: { id: true, name: true },
    })) ?? null
  );
}

/** Operator write. Callers must have checked access + org scope already. */
export async function setClientSmsNumber(
  orgId: string,
  clientId: string,
  e164: string | null,
): Promise<void> {
  await db
    .update(clients)
    .set({ smsNumber: e164 })
    .where(and(eq(clients.id, clientId), eq(clients.orgId, orgId)));
}

import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientSmsOptOuts, smsOptOuts } from "@/db/schema";

/**
 * STOP / START bookkeeping.
 *
 * Two scopes, matching how the carrier sees it:
 *  - Shared number (TWILIO_FROM_NUMBER): one number speaks for every business,
 *    so a STOP there blocks every business (`sms_opt_outs`, unchanged).
 *  - A business's own number (clients.sms_number): a STOP there blocks that
 *    business (`client_sms_opt_outs`) — from any number, so removing its own
 *    number later can't route texts around the STOP via the shared line.
 */

/** Normalize to bare digits with country code so lookups match reliably. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length === 10 ? `1${digits}` : digits;
}

/** Where a STOP/START arrived: omitted = the shared number. */
export interface OptOutScope {
  /** The business whose own number received the keyword. */
  clientId: string;
  /** That number, for the record. */
  businessPhone?: string | null;
}

/**
 * True when this phone must not be texted.
 *
 * With `clientId`: blocked by a shared-number STOP, or by a STOP to that
 * business's own number. Without it (a caller that doesn't know which business
 * is sending): blocked by ANY STOP, the conservative answer.
 */
export async function isOptedOut(
  phone: string | null | undefined,
  clientId?: string | null,
): Promise<boolean> {
  if (!phone?.trim()) return false;
  const key = normalizePhone(phone);
  try {
    const global = await db.query.smsOptOuts.findFirst({
      where: eq(smsOptOuts.phone, key),
      columns: { id: true },
    });
    if (global) return true;
    const scoped = await db.query.clientSmsOptOuts.findFirst({
      where: clientId
        ? and(eq(clientSmsOptOuts.phone, key), eq(clientSmsOptOuts.clientId, clientId))
        : eq(clientSmsOptOuts.phone, key),
      columns: { id: true },
    });
    return Boolean(scoped);
  } catch {
    // Fail SAFE for compliance: if we can't verify (migration lag), don't send.
    return true;
  }
}

export async function recordOptOut(
  phone: string,
  keyword: string,
  scope?: OptOutScope | null,
): Promise<void> {
  if (scope?.clientId) {
    await db
      .insert(clientSmsOptOuts)
      .values({
        clientId: scope.clientId,
        phone: normalizePhone(phone),
        businessPhone: scope.businessPhone ? normalizePhone(scope.businessPhone) : null,
        keyword,
      })
      .onConflictDoNothing({ target: [clientSmsOptOuts.phone, clientSmsOptOuts.clientId] });
    return;
  }
  await db
    .insert(smsOptOuts)
    .values({ phone: normalizePhone(phone), keyword })
    .onConflictDoNothing({ target: smsOptOuts.phone });
}

/**
 * START: lifts only the opt-out for the number it was sent to. START to one
 * business's number doesn't undo a STOP sent to the shared number (the carrier
 * still blocks the shared number too), and vice versa.
 */
export async function removeOptOut(phone: string, scope?: OptOutScope | null): Promise<void> {
  if (scope?.clientId) {
    await db
      .delete(clientSmsOptOuts)
      .where(
        and(
          eq(clientSmsOptOuts.phone, normalizePhone(phone)),
          eq(clientSmsOptOuts.clientId, scope.clientId),
        ),
      );
    return;
  }
  await db.delete(smsOptOuts).where(eq(smsOptOuts.phone, normalizePhone(phone)));
}

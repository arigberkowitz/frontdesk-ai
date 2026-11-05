import "server-only";
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { clientTextingPrefs, clients, smsQueue } from "@/db/schema";
import { logger } from "@/lib/logger";
import { DEFAULT_QUIET_END, DEFAULT_QUIET_START, type TextingPrefs } from "@/lib/texting-policy";
import type { OutboundLogContext } from "./sms-messages";

/** The business's texting prefs, or defaults. Null when the lookup fails (caller sends as before). */
export async function getTextingPrefs(clientId: string): Promise<TextingPrefs | null> {
  try {
    const c = await db.query.clients.findFirst({ where: eq(clients.id, clientId), columns: { timezone: true } });
    if (!c) return null;
    const p = await db.query.clientTextingPrefs.findFirst({ where: eq(clientTextingPrefs.clientId, clientId) });
    return {
      textingEnabled: p?.textingEnabled ?? true,
      quietStartHour: p?.quietStartHour ?? DEFAULT_QUIET_START,
      quietEndHour: p?.quietEndHour ?? DEFAULT_QUIET_END,
      timeZone: c.timezone,
    };
  } catch (err) {
    logger.warn("texting.prefs.lookup_failed", { clientId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function saveTextingPrefs(
  clientId: string,
  p: { textingEnabled: boolean; quietStartHour: number; quietEndHour: number },
): Promise<void> {
  await db
    .insert(clientTextingPrefs)
    .values({ clientId, ...p })
    .onConflictDoUpdate({ target: clientTextingPrefs.clientId, set: { ...p, updatedAt: new Date() } });
}

export async function enqueueSms(row: { to: string; body: string; log: OutboundLogContext; sendAfter: Date }): Promise<void> {
  await db.insert(smsQueue).values({
    clientId: row.log.clientId,
    toPhone: row.to,
    body: row.body,
    log: row.log,
    sendAfter: row.sendAfter,
  });
}

export async function dueSms(now: Date, limit = 200) {
  return db.query.smsQueue.findMany({
    where: and(eq(smsQueue.status, "queued"), lte(smsQueue.sendAfter, now)),
    limit,
  });
}

export async function markSms(id: string, status: "sent" | "failed" | "dropped", result: string | null): Promise<void> {
  await db.update(smsQueue).set({ status, result, updatedAt: new Date() }).where(eq(smsQueue.id, id));
}

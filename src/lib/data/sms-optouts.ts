import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { smsOptOuts } from "@/db/schema";

/** Normalize to bare digits with country code so lookups match reliably. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length === 10 ? `1${digits}` : digits;
}

/** True when this phone has texted STOP — nothing may text it again. */
export async function isOptedOut(phone: string | null | undefined): Promise<boolean> {
  if (!phone?.trim()) return false;
  try {
    const row = await db.query.smsOptOuts.findFirst({
      where: eq(smsOptOuts.phone, normalizePhone(phone)),
    });
    return Boolean(row);
  } catch {
    // Fail SAFE for compliance: if we can't verify (migration lag), don't send.
    return true;
  }
}

export async function recordOptOut(phone: string, keyword: string): Promise<void> {
  await db
    .insert(smsOptOuts)
    .values({ phone: normalizePhone(phone), keyword })
    .onConflictDoNothing({ target: smsOptOuts.phone });
}

export async function removeOptOut(phone: string): Promise<void> {
  await db.delete(smsOptOuts).where(eq(smsOptOuts.phone, normalizePhone(phone)));
}

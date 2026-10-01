import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerLanguages } from "@/db/schema";
import { normalizeCustomerLanguage } from "@/lib/languages";
import { logger } from "@/lib/logger";
import { normalizePhone } from "./sms-optouts";

/**
 * Remember which language a customer spoke, so texts can follow it.
 *
 * Fail-soft both ways: a missing table (migration 0012 not applied yet) or a
 * DB hiccup must never fail a booking, and the worst case is a text in
 * English, which is what every customer got before.
 */
export async function rememberCustomerLanguage(input: {
  clientId: string;
  phone: string | null | undefined;
  language: unknown;
}): Promise<void> {
  const language = normalizeCustomerLanguage(input.language);
  const phone = normalizePhone(input.phone ?? "");
  if (!language || !phone) return;
  try {
    await db
      .insert(customerLanguages)
      .values({ clientId: input.clientId, phone, language })
      .onConflictDoUpdate({
        target: [customerLanguages.clientId, customerLanguages.phone],
        set: { language, updatedAt: sql`now()` },
      });
  } catch (err) {
    logger.warn("customer_language.save_failed", {
      clientId: input.clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** The customer's language code, or null (unknown → English texts). */
export async function getCustomerLanguage(
  clientId: string,
  phone: string | null | undefined,
): Promise<string | null> {
  const key = normalizePhone(phone ?? "");
  if (!key) return null;
  try {
    const [row] = await db
      .select({ language: customerLanguages.language })
      .from(customerLanguages)
      .where(and(eq(customerLanguages.clientId, clientId), eq(customerLanguages.phone, key)))
      .limit(1);
    return row?.language ?? null;
  } catch (err) {
    logger.warn("customer_language.lookup_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

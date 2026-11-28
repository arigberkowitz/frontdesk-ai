import "server-only";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { appointments, clientSmsOptOuts, smsOptOuts, type Client } from "@/db/schema";
import { logger } from "@/lib/logger";
import { getConsentedPhones, isConsented } from "@/lib/data/sms-consents";
import { normalizePhone } from "@/lib/data/sms-optouts";
import { pastCustomers, upcomingPhoneKeys } from "@/lib/agents/winback";
import { phoneKey } from "@/lib/revenue-texts";
import { reviewTeaser, winbackTeaser, type TeaserCopy } from "@/lib/revenue-teasers";
import { reviewRequestBody } from "@/lib/review-requests";
import { isDueForWinback, winbackBody, winbackSettingsOf } from "@/lib/winback";

/**
 * The numbers behind the locked Pro cards: what each revenue text would have
 * done for this business, counted from its own calls and appointments. Every
 * reader fails soft to the generic line — a teaser is never worth an error.
 */

export interface Teaser extends TeaserCopy {
  /** The text a customer would have received (default wording, this business's name). */
  preview: string;
}

/** Phone keys among `phones` that replied STOP (shared number, or this business's own). */
export async function optedOutKeys(clientId: string, phones: string[]): Promise<Set<string>> {
  const normalized = [...new Set(phones.map((p) => normalizePhone(p)).filter((p) => p.length >= 10))];
  if (normalized.length === 0) return new Set();
  const [global, scoped] = await Promise.all([
    db.select({ phone: smsOptOuts.phone }).from(smsOptOuts).where(inArray(smsOptOuts.phone, normalized)),
    db
      .select({ phone: clientSmsOptOuts.phone })
      .from(clientSmsOptOuts)
      .where(and(eq(clientSmsOptOuts.clientId, clientId), inArray(clientSmsOptOuts.phone, normalized))),
  ]);
  return new Set([...global, ...scoped].map((r) => phoneKey(r.phone)).filter((k): k is string => Boolean(k)));
}

async function textableCount(clientId: string, phones: string[], purpose: "winback" | "review_request"): Promise<number> {
  if (phones.length === 0) return 0;
  const [consented, stopped] = await Promise.all([
    getConsentedPhones(clientId, purpose),
    optedOutKeys(clientId, phones),
  ]);
  return phones.filter((p) => isConsented(consented, p) && !stopped.has(phoneKey(p) ?? "")).length;
}

export async function winbackTeaserFor(client: Client, now = new Date()): Promise<Teaser> {
  const settings = winbackSettingsOf(client.setupFlags);
  const preview = winbackBody({ business: client.name, firstName: null, serviceName: null });
  try {
    const [customers, upcoming] = await Promise.all([pastCustomers(client.id, now), upcomingPhoneKeys(client.id, now)]);
    const due = customers.filter((c) =>
      isDueForWinback(
        { lastVisitAt: c.lastVisitAt, hasUpcoming: upcoming.has(phoneKey(c.phone) ?? ""), lastWinbackAt: null },
        settings.months,
        now,
      ),
    );
    const textable = await textableCount(client.id, due.map((c) => c.phone), "winback");
    const top = due[0];
    return {
      ...winbackTeaser({ due: due.length, textable, months: settings.months }),
      preview: top?.serviceName
        ? winbackBody({ business: client.name, firstName: null, serviceName: top.serviceName })
        : preview,
    };
  } catch (err) {
    logger.warn("revenue_teaser.winback_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...winbackTeaser({ due: 0, textable: 0, months: settings.months }), preview };
  }
}

const REVIEW_TEASER_DAYS = 30;

/** Booked visits that ended in the last 30 days, one per customer: each could have been asked. */
export async function reviewTeaserFor(client: Client, now = new Date()): Promise<Teaser> {
  const preview = reviewRequestBody({
    businessName: client.name,
    customerName: null,
    reviewUrl: client.reviewUrl?.trim() || "[your Google review link]",
  });
  try {
    const rows = await db
      .select({ phone: appointments.customerPhone })
      .from(appointments)
      .where(
        and(
          eq(appointments.clientId, client.id),
          inArray(appointments.status, ["booked", "confirmed"]),
          gte(appointments.startAt, new Date(now.getTime() - REVIEW_TEASER_DAYS * 86_400_000)),
          lte(appointments.startAt, now),
          isNull(appointments.deletedAt),
        ),
      )
      .limit(5_000);
    const byPhone = new Map<string, string>();
    for (const r of rows) {
      const key = phoneKey(r.phone);
      if (key && !byPhone.has(key)) byPhone.set(key, r.phone!);
    }
    const phones = [...byPhone.values()];
    const textable = await textableCount(client.id, phones, "review_request");
    return { ...reviewTeaser({ visits: phones.length, textable, days: REVIEW_TEASER_DAYS }), preview };
  } catch (err) {
    logger.warn("revenue_teaser.reviews_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...reviewTeaser({ visits: 0, textable: 0, days: REVIEW_TEASER_DAYS }), preview };
  }
}

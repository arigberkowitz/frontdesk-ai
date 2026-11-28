import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clientSmsOptOuts, smsOptOuts, type Client } from "@/db/schema";
import { logger } from "@/lib/logger";
import { getConsentedPhones, isConsented } from "@/lib/data/sms-consents";
import { normalizePhone } from "@/lib/data/sms-optouts";
import { pastCustomers, upcomingPhoneKeys } from "@/lib/agents/winback";
import { phoneKey } from "@/lib/revenue-texts";
import { quoteTeaser, winbackTeaser, type TeaserCopy } from "@/lib/revenue-teasers";
import { loadQuoteCandidates } from "@/lib/revenue/quote-followup-data";
import { renderFollowup } from "@/lib/revenue/quote-followup";
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

async function textableCount(clientId: string, phones: string[], purpose: "winback" | "quote_followup"): Promise<number> {
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

const QUOTE_TEASER_DAYS = 30;

/** Callers in the last 30 days who asked for a price and never booked. */
export async function quoteTeaserFor(client: Client, now = new Date()): Promise<Teaser> {
  const preview = renderFollowup({ step: 1, businessName: client.name, customerName: null, language: "en" });
  try {
    const cands = (await loadQuoteCandidates(client, now, QUOTE_TEASER_DAYS)) ?? [];
    const neverBooked = cands.filter((c) => !c.facts.bookedSince && !c.facts.hasUpcoming);
    const textable = await textableCount(client.id, neverBooked.map((c) => c.phone), "quote_followup");
    return { ...quoteTeaser({ asked: neverBooked.length, textable, days: QUOTE_TEASER_DAYS }), preview };
  } catch (err) {
    logger.warn("revenue_teaser.quote_failed", {
      clientId: client.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...quoteTeaser({ asked: 0, textable: 0, days: QUOTE_TEASER_DAYS }), preview };
  }
}

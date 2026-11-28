/**
 * The shared rules for the Pro "revenue texts" (win-back, review requests and
 * any later ones). Each is a text that leaves on the business's number,
 * unattended, to a person who did not ask for that exact message — so they all
 * go through one fence, written once and tested once.
 *
 * Pure and client-safe: the portal shows the same rules it enforces.
 *
 * Every one of these texts must:
 *  - go only to someone who already contacted the business (a caller or a
 *    customer), never a list someone uploaded
 *  - name the business and end with the opt-out line
 *  - go out between 9 AM and 8 PM in the business's own time zone
 *  - skip anyone who replied STOP, anyone the owner blocked, and anyone our
 *    call log marked as spam
 *  - respect one per-person cap across ALL of these features together, so a
 *    customer never gets a win-back on Monday and a review request on Tuesday
 */

/** First local hour a revenue text may go out (9 AM). */
export const SEND_START_HOUR = 9;
/** Local hour revenue texts stop (8 PM: the last send is before 20:00). */
export const SEND_END_HOUR = 20;

/** At most one revenue text (any feature) to the same person in this many days. */
export const MIN_DAYS_BETWEEN_REVENUE_TEXTS = 3;

/** Ceiling on revenue texts one business sends in a rolling 24 hours, all features. */
export const MAX_REVENUE_TEXTS_PER_CLIENT_PER_DAY = 50;

/**
 * Outbound `sms_messages.kind` values that count toward the shared per-person
 * cap: the Pro revenue texts plus the older automated nudges that are the same
 * kind of message (rebooking invitations, lead recovery).
 */
export const CAPPED_TEXT_KINDS: readonly string[] = [
  "winback",
  "review_request",
  "quote_followup",
  "recall",
  "recovery_lead",
  "recovery_no_show",
];

export const OPT_OUT_EN = "Reply STOP to opt out.";
export const OPT_OUT_ES = "Responda STOP para no recibir más mensajes.";

/** The local hour (0–23) in `timeZone`. Falls back to Pacific on a bad zone. */
export function localHourIn(now: Date, timeZone: string | null | undefined): number {
  const fmt = (tz: string) =>
    Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now)) % 24;
  try {
    return fmt(timeZone || "America/Los_Angeles");
  } catch {
    return fmt("America/Los_Angeles");
  }
}

/** True between 9 AM and 8 PM in the business's time zone. */
export function inSendWindow(now: Date, timeZone: string | null | undefined): boolean {
  const h = localHourIn(now, timeZone);
  return h >= SEND_START_HOUR && h < SEND_END_HOUR;
}

/** "2026-11" in the business's time zone: the key for "once a month". */
export function localMonthKey(now: Date, timeZone: string | null | undefined): string {
  const fmt = (tz: string) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(now);
    return `${p.find((x) => x.type === "year")?.value}-${p.find((x) => x.type === "month")?.value}`;
  };
  try {
    return fmt(timeZone || "America/Los_Angeles");
  } catch {
    return fmt("America/Los_Angeles");
  }
}

/** Last ten digits: how every phone comparison here is made. */
export function phoneKey(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

export type SkipReason =
  | "no_phone"
  | "opted_out"
  | "blocked"
  | "spam"
  | "no_consent"
  | "recently_texted"
  | "daily_cap";

export interface RecipientFacts {
  phone: string | null | undefined;
  optedOut: boolean;
  blocked: boolean;
  spam: boolean;
  /** A stored "yes, text me" from this person covers this kind of text. */
  consented: boolean;
  /** Most recent capped text (any feature) to this person, if any. */
  lastCappedTextAt: Date | null;
  /** Revenue texts this business sent in the last 24 hours. */
  sentTodayByClient: number;
}

/**
 * May this person get a revenue text right now? Null = yes; otherwise why not.
 * In the order a person would ask: did they say stop, did the owner block them,
 * are they a real caller, did they agree to texts, did we just text them.
 */
export function recipientSkipReason(f: RecipientFacts, now: Date): SkipReason | null {
  if (!phoneKey(f.phone)) return "no_phone";
  if (f.optedOut) return "opted_out";
  if (f.blocked) return "blocked";
  if (f.spam) return "spam";
  if (!f.consented) return "no_consent";
  if (f.lastCappedTextAt) {
    const days = (now.getTime() - f.lastCappedTextAt.getTime()) / 86_400_000;
    if (days < MIN_DAYS_BETWEEN_REVENUE_TEXTS) return "recently_texted";
  }
  if (f.sentTodayByClient >= MAX_REVENUE_TEXTS_PER_CLIENT_PER_DAY) return "daily_cap";
  return null;
}

/** Collapse whitespace, drop template braces and cap length: names come from calls. */
export function cleanField(value: string | null | undefined, max = 40): string {
  return (value ?? "").replace(/[{}<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function firstNameOf(name: string | null | undefined): string {
  return cleanField(cleanField(name, 60).split(" ")[0] ?? "", 30);
}

/** Longest template an owner can save, before the opt-out line. */
export const MAX_TEMPLATE_CHARS = 300;

export interface TemplateVars {
  business: string;
  firstName?: string | null;
  service?: string | null;
}

/**
 * Fill a template and make it safe to send:
 *  - unknown {placeholders} are removed rather than texted literally
 *  - "Hi {first_name}," with no name becomes "Hi,"
 *  - a template that never names the business gets "Business: " in front,
 *    because a text from a number that doesn't say who it is reads as spam
 *  - the opt-out line is always added at the end, in the text's language
 */
export function renderRevenueText(
  template: string,
  vars: TemplateVars,
  language: "en" | "es" = "en",
  fallbackService = language === "es" ? "su última visita" : "your last visit",
): string {
  const business = cleanField(vars.business, 60) || (language === "es" ? "nuestro negocio" : "our business");
  const first = firstNameOf(vars.firstName);
  const service = cleanField(vars.service, 40) || fallbackService;
  let body = template
    .replace(/\{first_name\}/gi, first)
    .replace(/\{business\}/gi, business)
    .replace(/\{service\}/gi, service)
    .replace(/\{[^}]*\}/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
  if (!body.toLowerCase().includes(business.toLowerCase())) body = `${business}: ${body}`;
  const optOut = language === "es" ? OPT_OUT_ES : OPT_OUT_EN;
  if (!/\bSTOP\b/.test(body)) body = `${body} ${optOut}`;
  return body;
}

/** Owner template check. Null = fine (empty = use the default); otherwise what to fix. */
export function templateProblem(template: string): string | null {
  const t = template.trim();
  if (!t) return null;
  if (t.length > MAX_TEMPLATE_CHARS) return `Keep it under ${MAX_TEMPLATE_CHARS} characters so it stays one or two texts.`;
  if (/https?:\/\//i.test(t) || /\bwww\./i.test(t)) {
    return "Leave links out. Carriers filter texts with links from numbers people don't know well.";
  }
  return null;
}

/** Real counts for a feature's results line. Never dollars we can't trace. */
export interface RevenueTextStats {
  /** Texts Twilio accepted. */
  sent: number;
  /** Different people those texts went to. */
  people: number;
  /** Texts that failed to send (for example, texting registration not approved yet). */
  failed: number;
  /** People who texted back within 7 days of a text. */
  replied: number;
  /** People who booked within 14 days after a text. */
  bookedAfter: number;
}

export const EMPTY_STATS: RevenueTextStats = { sent: 0, people: 0, failed: 0, replied: 0, bookedAfter: 0 };

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;

/** "Last 30 days: 12 texts sent to 8 people · 3 replied · 2 booked afterward", or null with nothing to show. */
export function statsLine(s: RevenueTextStats, days = 30): string | null {
  if (s.sent === 0 && s.failed === 0) return null;
  const parts = [`Last ${days} days: ${plural(s.sent, "text", "texts")} sent to ${plural(s.people, "person", "people")}`];
  parts.push(`${n(s.replied)} replied`);
  parts.push(`${n(s.bookedAfter)} booked afterward`);
  if (s.failed > 0) parts.push(`${plural(s.failed, "text", "texts")} couldn't be sent`);
  return parts.join(" · ");
}

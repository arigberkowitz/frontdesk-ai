/**
 * Smart rebooking — the pure rules. No I/O, client-safe, unit-tested.
 *
 * The owner blocks time that already has appointments in it; we show them the
 * casualties and, only when they click "Ask customers to rebook", text each
 * customer a short fixed message with 2–3 open times. Replies are parsed here,
 * deterministically — "1", "2", "3" or "NO". Nothing the customer writes is
 * ever given to a model or treated as an instruction; anything we can't parse
 * with certainty goes to the owner.
 */
import { blocksForProvider, businessWideBlocks, overlapsBlock, type AvailabilityBlockLite } from "@/lib/booking-window";
import { stripPhoneNumbers } from "@/lib/appointment-messages";

export const REBOOK_SLOT_COUNT = 3;
/** How far ahead we look for replacement times. */
export const REBOOK_SEARCH_DAYS = 14;
/** Replacement times start at least this far out, so nobody is offered "in 20 minutes". */
export const REBOOK_MIN_LEAD_HOURS = 2;
/** An offer stops accepting "1/2/3" after this long (or once its first slot has passed). */
export const REBOOK_OFFER_HOURS = 48;
/** Per-business ceiling on rebook offer texts in a rolling 24h. */
export const MAX_REBOOK_TEXTS_PER_DAY = 50;
/** How far ahead the Hours page looks for appointments a block now overlaps. */
export const AFFECTED_LOOKAHEAD_DAYS = 90;

export interface Slot {
  startAt: string;
  endAt: string;
}

/**
 * Does a block now sit on top of this appointment? A block tied to one team
 * member only affects that member's appointments; a business-wide block
 * affects everyone's.
 */
export function isAffected(
  appt: { startAt: Date; endAt: Date | null; providerId: string | null },
  blocks: AvailabilityBlockLite[],
  tz: string,
): boolean {
  const start = appt.startAt.getTime();
  const end = appt.endAt?.getTime() ?? start + 30 * 60_000;
  const applicable = appt.providerId ? blocksForProvider(blocks, appt.providerId) : businessWideBlocks(blocks);
  return overlapsBlock(applicable, tz, start, end);
}

function localDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

/**
 * Choose up to `count` replacement times, spread out: one per day first (people
 * who can't do Tuesday usually can't do any Tuesday time), then anything at
 * least two hours from what's already chosen. `exclude` holds times already
 * offered to someone else in this batch, so two customers aren't racing for
 * the same slot.
 */
export function pickSpreadSlots(
  slots: Slot[],
  opts: { count?: number; tz: string; exclude?: Set<string>; notBefore: Date },
): Slot[] {
  const count = opts.count ?? REBOOK_SLOT_COUNT;
  const pool = slots
    .filter((s) => !opts.exclude?.has(s.startAt))
    .filter((s) => new Date(s.startAt).getTime() >= opts.notBefore.getTime())
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const chosen: Slot[] = [];
  const days = new Set<string>();
  for (const s of pool) {
    if (chosen.length >= count) break;
    const d = localDay(s.startAt, opts.tz);
    if (days.has(d)) continue;
    days.add(d);
    chosen.push(s);
  }
  const TWO_HOURS = 2 * 3_600_000;
  for (const s of pool) {
    if (chosen.length >= count) break;
    const t = new Date(s.startAt).getTime();
    if (chosen.some((c) => Math.abs(new Date(c.startAt).getTime() - t) < TWO_HOURS)) continue;
    chosen.push(s);
  }
  return chosen.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** "Tue, Oct 6, 10:00 AM" in the business's zone. */
export function shortWhen(at: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

function clean(s: string, max = 60): string {
  return stripPhoneNumbers(s).replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * The offer. Fixed wording; the only variable parts are the business's name,
 * the business's own service name, and times. No customer-supplied text.
 * "NO" (not "CANCEL", which carriers treat as an opt-out keyword) declines.
 */
export function offerText(input: {
  businessName: string;
  serviceName: string | null;
  oldStartAt: Date;
  slots: Slot[];
  tz: string;
}): string {
  const what = input.serviceName ? `${clean(input.serviceName).toLowerCase()} appointment` : "appointment";
  const lines = input.slots.map((s, i) => `${i + 1}) ${shortWhen(s.startAt, input.tz)}`);
  const nums = input.slots.length === 1 ? "1" : input.slots.length === 2 ? "1 or 2" : "1, 2 or 3";
  return [
    `${clean(input.businessName) || "Your appointment"}: Sorry, we have to move your ${what} on ${shortWhen(input.oldStartAt, input.tz)}. Could one of these work instead?`,
    ...lines,
    `Reply ${nums} to switch, or NO to cancel. Reply STOP to opt out.`,
  ].join("\n");
}

export function rescheduledText(input: { businessName: string; startAt: Date; tz: string }): string {
  return `${clean(input.businessName)}: You're all set for ${shortWhen(input.startAt, input.tz)}. Thanks for being flexible!`;
}

export function cancelledText(input: { businessName: string }): string {
  return `${clean(input.businessName)}: No problem, your appointment is cancelled. Call or text us anytime to book again.`;
}

export function slotGoneText(input: { businessName: string }): string {
  return `${clean(input.businessName)}: Sorry, that time was just taken. Someone from our team will text you shortly to find another time.`;
}

export type RebookReply = { kind: "pick"; index: number } | { kind: "decline" } | { kind: "unclear" };

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, first: 1, second: 2, third: 3 };
const NEGATION = /\b(no|not|can'?t|cannot|don'?t|won'?t|none|neither|nor|but|instead|later|earlier|other)\b/i;
const DECLINE = /^(no|nope|nah|no thanks|no thank you|none|none of those|none work|neither|please cancel|cancel it|cancel my appointment)[\s.!]*$/i;

/**
 * Read a reply to an offer of `n` slots. Conservative by design: a bare number
 * (optionally "#2", "option 2", "2 please", "the second one") is a pick; a
 * short, clear "no" is a decline; everything else — "2 doesn't work, how about
 * Friday?", "1 or 2", "not 3", an essay, an instruction — is unclear and goes
 * to the owner. This is the prompt-injection stance for this feature: the
 * customer's words are matched, never interpreted.
 */
export function parseRebookReply(body: string, n: number): RebookReply {
  const text = body
    .trim()
    .toLowerCase()
    .replace(/[‘’“”"]/g, "'")
    .replace(/\b(first|second|third)\s+one\b/g, "$1");
  if (!text || text.length > 40) return { kind: "unclear" };
  if (DECLINE.test(text)) return { kind: "decline" };

  const digits = text.match(/\d+/g) ?? [];
  const words = (text.match(/\b(one|two|three|first|second|third)\b/g) ?? []).map((w) => WORD_NUM[w]);
  const picks = [...digits.map(Number), ...words];
  if (picks.length !== 1) return { kind: "unclear" };
  const idx = picks[0];
  if (!(idx >= 1 && idx <= n)) return { kind: "unclear" };
  // Anything beyond the pick that could flip its meaning → a human reads it.
  if (NEGATION.test(text)) return { kind: "unclear" };
  const rest = text
    .replace(/\d+|\b(one|two|three|first|second|third)\b/g, "")
    .replace(/\b(option|number|the|one|please|pls|thanks|thank you|ok|okay|works|sounds good|great|perfect|yes|yeah|sure)\b/g, "")
    .replace(/[#.!,)\s-]/g, "");
  if (rest.length > 0) return { kind: "unclear" };
  return { kind: "pick", index: idx - 1 };
}

/** Is an offer still answerable? */
export function offerIsLive(
  offer: { status: string; expiresAt: Date | null; slots: Slot[] },
  now: Date,
): boolean {
  if (offer.status !== "sent") return false;
  if (offer.expiresAt && offer.expiresAt.getTime() <= now.getTime()) return false;
  return offer.slots.some((s) => new Date(s.startAt).getTime() > now.getTime());
}

/** Owner-facing status words for the Hours page. */
export function rebookStatusLabel(
  offer: { status: string; skipReason: string | null; expiresAt: Date | null; respondedAt?: Date | null } | null,
  now: Date,
): { label: string; tone: "muted" | "pending" | "good" | "warn" } {
  if (!offer) return { label: "Not asked yet", tone: "muted" };
  switch (offer.status) {
    case "sent":
      if (offer.respondedAt) return { label: "Replied — needs you (see Messages)", tone: "warn" };
      return offer.expiresAt && offer.expiresAt.getTime() <= now.getTime()
        ? { label: "No reply — call them", tone: "warn" }
        : { label: "Text sent, waiting", tone: "pending" };
    case "processing":
      return { label: "Working on their reply…", tone: "pending" };
    case "rescheduled":
      return { label: "Rescheduled", tone: "good" };
    case "cancelled":
      return { label: "Cancelled by customer", tone: "good" };
    case "needs_owner":
      return { label: "Replied — needs you (see Messages)", tone: "warn" };
    case "failed":
      return { label: "Text failed — call them", tone: "warn" };
    case "skipped":
      return { label: skipLabel(offer.skipReason), tone: "warn" };
    default:
      return { label: offer.status, tone: "muted" };
  }
}

function skipLabel(reason: string | null): string {
  switch (reason) {
    case "opted_out":
      return "Not texted — they opted out. Call them";
    case "no_consent":
      return "Not texted — no texting permission. Call them";
    case "no_phone":
      return "Not texted — no mobile number. Call them";
    case "no_slots":
      return "Not texted — no open times found";
    case "daily_cap":
      return "Not texted — daily limit reached, try tomorrow";
    case "sms_not_configured":
      return "Not texted — texting isn't connected";
    default:
      return "Not texted — call them";
  }
}

/**
 * The Overview value card ("Frontdesk booked you $X this month") — the pure
 * part: raw month counts in, the exact copy out. No DB, client-safe, tested.
 *
 * Honesty rules:
 *  - Revenue is EARNED revenue only (appointment has happened, at its
 *    service's price) — the same rule as the "Revenue captured" tile.
 *    Booked-but-upcoming money is mentioned separately, never added in.
 *  - A count we couldn't load is "—", never 0.
 *  - A feature that's off says "Off", not "0".
 *  - Appointments with no price add $0 and we say so, instead of guessing.
 */

import { formatCurrencyCents } from "./format";

export interface MonthValueStats {
  revenue: { earnedCents: number; completed: number; unpriced: number; upcomingCents: number; upcoming: number } | null;
  calls: { calls: number; afterHours: number } | null;
  recovery: { sent: number; recovered: number } | null;
  texts: { aiTexts: number; conversations: number } | null;
}

export interface ValueStat {
  key: "afterHours" | "recovered" | "aiTexts";
  label: string;
  value: string;
  caption: string;
  href: string;
  /** The feature behind it is switched off. */
  off?: boolean;
}

export interface ValueCardView {
  monthLabel: string;
  /** null when the revenue query failed. */
  amount: string | null;
  /** Full sentence (screen readers, tests): "Frontdesk booked you $960 this month". */
  headline: string;
  /** The words around the big number: lead · amount · trail. */
  lead: string;
  trail: string;
  notes: { text: string; href?: string; linkText?: string }[];
  stats: ValueStat[];
  /** Nothing at all has happened this month yet (no calls, bookings or texts). */
  quiet: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function monthLabel(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long" }).format(now);
}

export function buildValueCard(
  s: MonthValueStats,
  opts: {
    now?: Date;
    timeZone: string;
    appointmentWord?: { one: string; many: string };
    missedCallTextsEnabled: boolean;
    aiTextRepliesEnabled: boolean;
  },
): ValueCardView {
  const month = monthLabel(opts.now ?? new Date(), opts.timeZone);
  const w = opts.appointmentWord ?? { one: "appointment", many: "appointments" };
  const appts = (n: number) => plural(n, w.one, w.many);
  const notes: ValueCardView["notes"] = [];

  let amount: string | null = null;
  let headline: string;
  let lead = "Frontdesk booked you";
  let trail = "this month";
  const r = s.revenue;
  if (!r) {
    headline = "We couldn't load this month's bookings right now.";
  } else {
    amount = formatCurrencyCents(r.earnedCents);
    if (r.earnedCents > 0) {
      headline = `Frontdesk booked you ${amount} this month`;
    } else {
      headline = `Nothing earned yet in ${month}`;
      lead = `Earned so far in ${month}`;
      trail = "";
    }
    if (r.completed > 0 && r.earnedCents > 0) {
      notes.push({
        text: `From ${appts(r.completed)} that happened since ${month} 1, each at its service's price.`,
      });
    } else if (r.completed === 0 && r.upcoming === 0) {
      notes.push({ text: `No ${w.many} have happened yet this month. This fills in as your AI books them.` });
    }
    if (r.unpriced > 0) {
      notes.push({
        text: `${appts(r.unpriced)} ${r.unpriced === 1 ? "has" : "have"} no price on the service, so ${r.unpriced === 1 ? "it adds" : "they add"} $0.`,
        href: "/portal/services",
        linkText: "Add prices",
      });
    }
    if (r.upcoming > 0) {
      notes.push({
        text:
          r.upcomingCents > 0
            ? `Plus ${formatCurrencyCents(r.upcomingCents)} booked for later in ${month} (${appts(r.upcoming)}) — it counts once it happens.`
            : `Plus ${appts(r.upcoming)} booked for later in ${month} — counted once ${r.upcoming === 1 ? "it happens" : "they happen"}.`,
      });
    }
  }

  const stats: ValueStat[] = [];
  // After-hours calls answered.
  const c = s.calls;
  stats.push({
    key: "afterHours",
    label: "After-hours calls answered",
    value: c ? String(c.afterHours) : "—",
    caption: !c
      ? "Couldn't load calls right now"
      : c.afterHours > 0
        ? `Calls outside your open hours — ones you'd likely have missed`
        : c.calls > 0
          ? "None this month — every call came in during open hours"
          : "No calls yet this month",
    href: "/portal/calls",
  });
  // Missed / dropped calls recovered by text-back.
  const rec = s.recovery;
  if (!opts.missedCallTextsEnabled && (!rec || rec.sent === 0)) {
    stats.push({
      key: "recovered",
      label: "Missed calls won back",
      value: "Off",
      caption: "Turn on missed-call text-back to follow up callers who hung up",
      href: "/portal/settings/follow-ups",
      off: true,
    });
  } else {
    stats.push({
      key: "recovered",
      label: "Missed calls won back",
      value: rec ? String(rec.recovered) : "—",
      caption: !rec
        ? "Couldn't load follow-ups right now"
        : rec.sent === 0
          ? "No missed or dropped calls needed a text yet"
          : `Of ${plural(rec.sent, "caller")} we texted after a missed or dropped call, ${rec.recovered} booked, called or texted back`,
      href: "/portal/calls",
    });
  }
  // Texts handled by the AI.
  const t = s.texts;
  if (!opts.aiTextRepliesEnabled && (!t || t.aiTexts === 0)) {
    stats.push({
      key: "aiTexts",
      label: "Texts handled by your AI",
      value: "Off",
      caption: "Turn on AI text replies to answer customer texts for you",
      href: "/portal/settings/follow-ups",
      off: true,
    });
  } else {
    stats.push({
      key: "aiTexts",
      label: "Texts handled by your AI",
      value: t ? String(t.aiTexts) : "—",
      caption: !t
        ? "Couldn't load texts right now"
        : t.aiTexts === 0
          ? "No customer texts for it to answer yet"
          : `AI replies across ${plural(t.conversations, "conversation")}`,
      href: "/portal/messages",
    });
  }

  const quiet =
    Boolean(r && c && t) &&
    r!.completed === 0 &&
    r!.upcoming === 0 &&
    c!.calls === 0 &&
    t!.aiTexts === 0 &&
    (rec?.sent ?? 0) === 0;

  return { monthLabel: month, amount, headline, lead, trail, notes, stats, quiet };
}

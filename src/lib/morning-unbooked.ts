/**
 * "Last night's callers who didn't book" — the morning owner text, pure half.
 * No DB, no env, no vendor SDKs: the cron, the Overview switch and the tests
 * all go through these functions.
 *
 * What it is: each morning (8–11am in the business's own timezone) the owner
 * gets ONE short text listing the people who rang after hours overnight and
 * did not end up with a booking — name or number, what they wanted, and a
 * link straight to them in the portal. On a plan with AI call-backs the text
 * points at the "AI calls them" button on the lead. Nobody to list → no text.
 *
 * Honesty rules: every name, number and reason comes from our own call and
 * lead rows. Nothing is guessed — a caller who left no details reads "no
 * details left", never an invented reason.
 */
import { shiftDayKey, zoneOffsetMinutes } from "./daily-briefing";
import { formatPhone } from "./format";
import { tzDayKey } from "./tz";

/** Notification payload.kind used for the per-day claim (no migration needed). */
export const MORNING_UNBOOKED_KIND = "morning_unbooked_text";

/** Local hours in which the text may go out. Wider than one cron slot on purpose. */
export const MORNING_TEXT_START_HOUR = 8;
export const MORNING_TEXT_END_HOUR = 11;

/**
 * "Last night" = from 8am local yesterday to 8am local today. Fixed,
 * back-to-back windows, so a caller is never listed on two mornings and none
 * fall in a gap, whichever cron slot happens to send.
 */
export const WINDOW_EDGE_HOUR = 8;

/** Most callers listed by name; the rest are a count plus a link. Keeps it one screen. */
export const MAX_LISTED = 5;

/** Is the morning text switched on for this business? Opt-in, like the briefing. */
export function morningUnbookedEnabled(client: { setupFlags?: { morningUnbookedText?: boolean } | null }): boolean {
  return client.setupFlags?.morningUnbookedText === true;
}

function localHour(at: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).formatToParts(at);
  return Number(p.find((x) => x.type === "hour")?.value ?? 0) % 24;
}

/** Is it morning-text time for this business right now? Unknown zone → never. */
export function morningTextDue(now: Date, timeZone: string): boolean {
  let hour: number;
  try {
    hour = localHour(now, timeZone);
  } catch {
    return false;
  }
  return hour >= MORNING_TEXT_START_HOUR && hour < MORNING_TEXT_END_HOUR;
}

/** The instant the local clock reads `hour`:00 on `dayKey` in `timeZone` (DST-safe). */
export function zonedHour(dayKey: string, hour: number, timeZone: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  let instant = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  instant = guess - zoneOffsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

export interface MorningWindow {
  /** Local date of "this morning" — the dedupe key. */
  dayKey: string;
  start: Date;
  end: Date;
}

export function morningWindow(now: Date, timeZone: string): MorningWindow {
  const dayKey = tzDayKey(now, timeZone);
  return {
    dayKey,
    start: zonedHour(shiftDayKey(dayKey, -1), WINDOW_EDGE_HOUR, timeZone),
    end: zonedHour(dayKey, WINDOW_EDGE_HOUR, timeZone),
  };
}

/* ------------------------------- candidates ------------------------------ */

export interface AfterHoursCallRow {
  callId: string;
  fromNumber: string | null;
  startAt: Date | null;
  outcome: string | null;
  summary: string | null;
  lead: {
    id: string;
    name: string | null;
    phone: string | null;
    reason: string | null;
    service: string | null;
    status: string;
  } | null;
}

export interface UnbookedCaller {
  callId: string;
  leadId: string | null;
  name: string | null;
  phone: string | null;
  /** What they wanted, from the lead or the call summary; null = they left nothing. */
  wanted: string | null;
  hungUp: boolean;
  startAt: Date | null;
}

/** Last ten digits — how the rest of the app compares numbers. */
export function phoneKey(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

const SKIP_OUTCOMES = new Set(["booked", "spam"]);

/** First sentence of a summary, trimmed to something that fits in a text. */
export function shortWanted(text: string | null | undefined, max = 70): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
  const s = first.replace(/[.!?]+$/, "");
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * Who goes in the text: after-hours inbound calls (already filtered by the
 * query) that didn't book, minus spam, minus anyone who has a booking made
 * since (by phone, chat or text), minus leads the owner already handled or
 * who texted back, minus blocked numbers — one entry per caller.
 */
export function pickUnbookedCallers(
  rows: AfterHoursCallRow[],
  opts: {
    bookedPhones: Set<string>;
    bookedCallIds: Set<string>;
    blockedNumbers?: string[] | null;
    /** Lead ids where the caller has texted back since — the owner's already talking to them. */
    repliedLeadIds?: Set<string>;
  },
): UnbookedCaller[] {
  const blocked = new Set((opts.blockedNumbers ?? []).map((n) => phoneKey(n)).filter(Boolean) as string[]);
  const byCaller = new Map<string, UnbookedCaller>();
  const sorted = [...rows].sort((a, b) => (a.startAt?.getTime() ?? 0) - (b.startAt?.getTime() ?? 0));
  for (const r of sorted) {
    if (r.outcome && SKIP_OUTCOMES.has(r.outcome)) continue;
    if (opts.bookedCallIds.has(r.callId)) continue;
    const phone = r.lead?.phone?.trim() || r.fromNumber?.trim() || null;
    const key = phoneKey(phone);
    if (key && (opts.bookedPhones.has(key) || blocked.has(key))) continue;
    if (r.lead && r.lead.status !== "new") continue;
    if (r.lead && opts.repliedLeadIds?.has(r.lead.id)) continue;

    const entry: UnbookedCaller = {
      callId: r.callId,
      leadId: r.lead?.id ?? null,
      name: r.lead?.name?.trim() || null,
      phone,
      wanted: shortWanted(r.lead?.reason) ?? shortWanted(r.lead?.service) ?? shortWanted(r.summary),
      hungUp: r.outcome === "missed",
      startAt: r.startAt,
    };
    const k = key ?? `call:${r.callId}`;
    const prev = byCaller.get(k);
    if (!prev) {
      byCaller.set(k, entry);
      continue;
    }
    // Same caller twice: keep the latest call, but never lose the lead (it's
    // where the call-back button lives) or the details they gave earlier.
    byCaller.set(k, {
      ...entry,
      leadId: entry.leadId ?? prev.leadId,
      name: entry.name ?? prev.name,
      wanted: entry.wanted ?? prev.wanted,
      hungUp: entry.hungUp && prev.hungUp,
    });
  }
  // A caller who later blocked/booked on a second call is handled above; the
  // earliest caller first reads naturally ("who rang first").
  return [...byCaller.values()];
}

/* --------------------------------- render -------------------------------- */

export function callerLink(base: string, c: Pick<UnbookedCaller, "leadId" | "callId">): string {
  const b = base.replace(/\/$/, "");
  return c.leadId ? `${b}/portal/leads#lead-${c.leadId}` : `${b}/portal/calls/${c.callId}`;
}

/**
 * The text itself. `canAiCall` = the plan has AI call-backs; the hint only
 * appears when at least one listed caller has a lead (that's where the button is).
 */
export function renderMorningUnbookedText(input: {
  businessName: string;
  callers: UnbookedCaller[];
  baseUrl: string;
  canAiCall: boolean;
}): string | null {
  const { callers } = input;
  if (!callers.length) return null;
  const n = callers.length;
  const head = `🌙 ${input.businessName}: ${n} after-hours ${n === 1 ? "caller" : "callers"} last night didn't book.`;
  const lines = callers.slice(0, MAX_LISTED).map((c, i) => {
    const who = c.name
      ? `${c.name}${c.phone ? ` ${formatPhone(c.phone)}` : ""}`
      : c.phone
        ? formatPhone(c.phone)
        : "Number withheld";
    const what = c.wanted ?? (c.hungUp ? "hung up before leaving details" : "no details left");
    return `${i + 1}. ${who} — ${what}\n${callerLink(input.baseUrl, c)}`;
  });
  const more = n > MAX_LISTED ? [`+${n - MAX_LISTED} more: ${input.baseUrl.replace(/\/$/, "")}/portal/leads`] : [];
  const hasLead = callers.slice(0, MAX_LISTED).some((c) => c.leadId);
  const tail =
    input.canAiCall && hasLead
      ? `On a lead, tap "AI calls them" to have your AI ring them back.`
      : `Tap a link for the details and their number.`;
  return [head, ...lines, ...more, tail].join("\n");
}

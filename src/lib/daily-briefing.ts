/**
 * The daily owner briefing — the pure half. No DB, no env, no model: the
 * cron, the portal preview, the Overview card and the tests all go through
 * these functions, so what an owner previews is exactly what they're sent.
 *
 * Shape of the thing:
 *   - Facts are gathered from our own tables (data/daily-briefing.ts) and are
 *     the ONLY source of truth. Names, numbers, times and phone numbers in the
 *     email are always rendered from facts, never from model output.
 *   - The model (agents/briefing.ts) contributes two things: a short opening
 *     paragraph and an ordering of who to call back first, with a one-line note
 *     each. It refers to callbacks by ref ("C1"), and anything it says that we
 *     can't tie back to the facts is dropped (see `groundAiBriefing`).
 *   - A quiet day never reaches the model at all.
 */
import { tzDayKey, tzTime } from "./tz";
import { formatPhone } from "./format";

/* --------------------------------- time ---------------------------------- */

/** Local hours (business timezone) in which the morning briefing may go out. */
export const BRIEFING_START_HOUR = 7;
/**
 * End of the send window. Wider than one cron slot on purpose: Vercel Hobby
 * crons fire anywhere in their hour, and a missed slot should be caught by the
 * next one rather than skipping the day. Nobody wants "this morning" at 2pm.
 */
export const BRIEFING_END_HOUR = 10;

function zonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Minutes the zone is ahead of UTC at `at` (e.g. -240 for EDT). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant local midnight starts on `dayKey` ("2026-09-30") in `timeZone`. */
export function zonedMidnight(dayKey: string, timeZone: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Two passes handle a DST change between the guess and the real instant.
  let instant = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  instant = guess - zoneOffsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

/** "2026-09-30" → "2026-09-29" (calendar arithmetic, no zone involved). */
export function shiftDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export interface BriefingWindow {
  /** Local date of "today" — the dedupe key. */
  dayKey: string;
  yesterdayStart: Date;
  todayStart: Date;
  tomorrowStart: Date;
}

/** Yesterday / today / tomorrow boundaries in the business's own calendar. */
export function briefingWindow(now: Date, timeZone: string): BriefingWindow {
  const dayKey = tzDayKey(now, timeZone);
  return {
    dayKey,
    yesterdayStart: zonedMidnight(shiftDayKey(dayKey, -1), timeZone),
    todayStart: zonedMidnight(dayKey, timeZone),
    tomorrowStart: zonedMidnight(shiftDayKey(dayKey, 1), timeZone),
  };
}

/** Is it briefing time for this business right now? */
export function briefingDue(now: Date, timeZone: string): boolean {
  let hour: number;
  try {
    hour = zonedParts(now, timeZone).hour;
  } catch {
    return false; // An unknown zone gets nothing rather than a 3am email.
  }
  return hour >= BRIEFING_START_HOUR && hour < BRIEFING_END_HOUR;
}

/* --------------------------------- facts --------------------------------- */

export interface BriefingAppointment {
  /** Stable ref the model may cite ("A1"). */
  ref: string;
  startAt: Date;
  customerName: string | null;
  service: string | null;
  status: string;
}

export type CallbackKind = "message" | "transfer_failed" | "asked_for_person";

export interface BriefingCallback {
  ref: string;
  kind: CallbackKind;
  /** When the message was left / the call happened. */
  at: Date;
  name: string | null;
  phone: string | null;
  /** Caller-authored (or caller-derived) text. DATA, never instructions. */
  reason: string | null;
  urgency: string | null;
  urgent: boolean;
  callId: string | null;
  leadId: string | null;
}

export interface BriefingCounts {
  calls: number;
  booked: number;
  messages: number;
  afterHours: number;
  spam: number;
  bookingsMade: number;
  cancellations: number;
}

export interface BriefingFacts {
  businessName: string;
  timeZone: string;
  dayKey: string;
  counts: BriefingCounts;
  /** Appointments cancelled yesterday (for the "cancellations" list). */
  cancellations: BriefingAppointment[];
  /** Unresolved: open messages (last 7 days) + yesterday's failed handoffs. */
  callbacks: BriefingCallback[];
  /** Today's schedule, in time order. */
  today: BriefingAppointment[];
}

/**
 * Anything in here would be worth a phone call today. Kept broad, same spirit
 * as call-health's EMERGENCY list: a false positive costs a bold line.
 */
export const URGENT_RE =
  /\b(asap|urgent|emergenc\w*|right away|immediately|today|tonight|leak\w*|flood\w*|burst|no heat|no water|gas|smoke|fire|pain|bleeding|swelling|locked out|broken|not working)\b/i;

export function isUrgentText(...texts: (string | null | undefined)[]): boolean {
  return URGENT_RE.test(texts.filter(Boolean).join(" "));
}

/** Nothing happened and nothing is waiting. The email says so in two lines. */
export function isQuietDay(f: BriefingFacts): boolean {
  return (
    f.counts.calls === 0 &&
    f.counts.bookingsMade === 0 &&
    f.counts.cancellations === 0 &&
    f.callbacks.length === 0 &&
    f.today.length === 0
  );
}

/* ------------------------- model input + grounding ------------------------ */

/**
 * Caller-authored text, made safe to sit inside a prompt as data: one line,
 * capped, and unable to close the <caller_data> fence it's placed in.
 */
export function callerData(text: string | null | undefined, max = 200): string {
  return (text ?? "")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const KIND_LABEL: Record<CallbackKind, string> = {
  message: "left a message",
  transfer_failed: "was transferred but didn't reach anyone",
  asked_for_person: "asked for a person and didn't get one",
};

/** The facts as the model sees them. Names and phones are deliberately left out. */
export function briefingPromptFacts(f: BriefingFacts, now: Date = new Date()): string {
  const c = f.counts;
  const lines = [
    `Business: ${callerData(f.businessName, 120)}`,
    `Yesterday: ${c.calls} calls answered (${c.booked} booked, ${c.messages} left a message, ${c.afterHours} after hours, ${c.spam} spam). ${c.bookingsMade} new bookings made. ${c.cancellations} cancellations.`,
    `Today's schedule: ${f.today.length} appointment${f.today.length === 1 ? "" : "s"}.`,
    "",
    "Callbacks waiting (ref | what happened | marked urgent by keyword | hours ago):",
  ];
  if (f.callbacks.length === 0) lines.push("(none)");
  for (const cb of f.callbacks) {
    lines.push(
      `${cb.ref} | ${KIND_LABEL[cb.kind]} | ${cb.urgent ? "urgent" : "not urgent"} | ${Math.max(0, Math.round((now.getTime() - cb.at.getTime()) / 3_600_000))}h`,
    );
    const said = [callerData(cb.reason), cb.urgency ? `urgency: ${callerData(cb.urgency, 60)}` : ""]
      .filter(Boolean)
      .join(" · ");
    if (said) lines.push(`  <caller_data>${said}</caller_data>`);
  }
  return lines.join("\n");
}

export interface AiBriefing {
  opening: string;
  priorities: { ref: string; note: string }[];
}

/** Numbers the opening may mention: the counts, and nothing else. */
function allowedNumbers(f: BriefingFacts): Set<string> {
  const c = f.counts;
  return new Set(
    [
      c.calls,
      c.booked,
      c.messages,
      c.afterHours,
      c.spam,
      c.bookingsMade,
      c.cancellations,
      f.callbacks.length,
      f.callbacks.filter((x) => x.urgent).length,
      f.today.length,
    ].map(String),
  );
}

/**
 * Keep only what the facts can vouch for.
 *  - Priorities must cite a real ref (each once); notes are one line, capped,
 *    and lose any digit run of 3+ (no invented phone numbers or prices).
 *  - The opening may only use numbers that appear in the counts. One stray
 *    number and the whole opening is replaced with our own — a briefing that
 *    says "you had 12 calls" after 4 is worse than a plain one.
 */
export function groundAiBriefing(raw: unknown, f: BriefingFacts): AiBriefing | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { opening?: unknown; priorities?: unknown };
  const refs = new Set(f.callbacks.map((c) => c.ref));
  const seen = new Set<string>();
  const priorities: AiBriefing["priorities"] = [];
  if (Array.isArray(r.priorities)) {
    for (const p of r.priorities) {
      if (!p || typeof p !== "object") continue;
      const ref = String((p as { ref?: unknown }).ref ?? "").trim().toUpperCase();
      if (!refs.has(ref) || seen.has(ref)) continue;
      seen.add(ref);
      const note = String((p as { note?: unknown }).note ?? "")
        .replace(/\d{3,}/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
      priorities.push({ ref, note });
      if (priorities.length >= 5) break;
    }
  }
  let opening = typeof r.opening === "string" ? r.opening.replace(/\s+/g, " ").trim().slice(0, 400) : "";
  const allowed = allowedNumbers(f);
  const numbers = opening.match(/\d+/g) ?? [];
  if (numbers.some((n) => !allowed.has(String(Number(n))))) opening = "";
  if (!opening && priorities.length === 0) return null;
  return { opening, priorities };
}

/* -------------------------------- rendering ------------------------------- */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Our own opening, used for quiet days and whenever the model's is unusable. */
export function fallbackOpening(f: BriefingFacts): string {
  if (isQuietDay(f)) return "Quiet day yesterday: no calls, and nothing on the schedule today.";
  const c = f.counts;
  const parts = [
    c.calls === 0
      ? "No calls yesterday."
      : `Yesterday your AI answered ${plural(c.calls, "call", "calls")}${c.booked ? `, booked ${c.booked}` : ""}${c.messages ? ` and took ${plural(c.messages, "message", "messages")}` : ""}.`,
  ];
  const urgent = f.callbacks.filter((x) => x.urgent).length;
  if (f.callbacks.length)
    parts.push(
      `${plural(f.callbacks.length, "person needs", "people need")} a call back${urgent ? ` (${urgent} sound${urgent === 1 ? "s" : ""} urgent)` : ""}.`,
    );
  parts.push(
    f.today.length ? `You have ${plural(f.today.length, "appointment", "appointments")} today.` : "Nothing on the schedule today.",
  );
  return parts.join(" ");
}

export interface BriefingCallbackView {
  ref: string;
  who: string;
  phone: string | null;
  what: string;
  note: string | null;
  urgent: boolean;
  link: string | null;
}

/** Callbacks in the order to make them: model's priorities first, then urgent, then newest. */
export function orderedCallbacks(
  f: BriefingFacts,
  ai: AiBriefing | null,
  baseUrl: string,
): BriefingCallbackView[] {
  const base = baseUrl.replace(/\/$/, "");
  const notes = new Map((ai?.priorities ?? []).map((p, i) => [p.ref, { note: p.note, rank: i }]));
  const sorted = [...f.callbacks].sort((a, b) => {
    const ra = notes.get(a.ref)?.rank ?? Infinity;
    const rb = notes.get(b.ref)?.rank ?? Infinity;
    if (ra !== rb) return ra - rb;
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return b.at.getTime() - a.at.getTime();
  });
  return sorted.map((cb) => {
    const phone = cb.phone ? formatPhone(cb.phone) : null;
    const reason = cb.reason?.replace(/\s+/g, " ").trim().slice(0, 140) || null;
    return {
      ref: cb.ref,
      who: cb.name?.trim() || phone || "Unknown caller",
      phone,
      what: reason ? `${KIND_LABEL[cb.kind]}: ${reason}` : KIND_LABEL[cb.kind],
      note: notes.get(cb.ref)?.note || null,
      urgent: cb.urgent,
      link: cb.callId ? `${base}/portal/calls/${cb.callId}` : cb.leadId ? `${base}/portal/leads` : null,
    };
  });
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (ch) =>
    ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&amp;",
  );
}

export interface BriefingEmailInput {
  facts: BriefingFacts;
  ai: AiBriefing | null;
  baseUrl: string;
}

export interface RenderedBriefing {
  subject: string;
  html: string;
  text: string;
  /** What the Overview card shows. Stored with the send so the card costs nothing. */
  card: BriefingCard;
}

export interface BriefingCard {
  dayKey: string;
  opening: string;
  quiet: boolean;
  callbacks: { who: string; what: string; note: string | null; urgent: boolean; link: string | null }[];
  todayCount: number;
  calls: number;
  bookingsMade: number;
  cancellations: number;
}

export function renderBriefing({ facts: f, ai, baseUrl }: BriefingEmailInput): RenderedBriefing {
  const base = baseUrl.replace(/\/$/, "");
  const quiet = isQuietDay(f);
  const opening = (!quiet && ai?.opening) || fallbackOpening(f);
  const callbacks = orderedCallbacks(f, quiet ? null : ai, base);
  const urgentCount = callbacks.filter((c) => c.urgent).length;
  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${f.dayKey}T12:00:00Z`));
  const subject = quiet
    ? `${f.businessName}: quiet day, nothing waiting`
    : urgentCount
      ? `${f.businessName}: ${plural(urgentCount, "urgent callback", "urgent callbacks")} · your ${dayLabel} briefing`
      : `${f.businessName}: your ${dayLabel} briefing`;
  const settingsLink = `${base}/portal/settings/alerts#daily-briefing`;
  const c = f.counts;

  const cbHtml = callbacks
    .slice(0, 8)
    .map(
      (cb) => `<li style="margin:0 0 10px">
      <strong>${cb.urgent ? "🚨 " : ""}${esc(cb.who)}</strong>${cb.phone && cb.phone !== cb.who ? ` · ${esc(cb.phone)}` : ""}<br>
      <span style="color:#444">${esc(cb.what)}</span>${cb.note ? `<br><span style="color:#6366f1">${esc(cb.note)}</span>` : ""}${
        cb.link ? `<br><a href="${esc(cb.link)}" style="font-size:13px">Open</a>` : ""
      }
    </li>`,
    )
    .join("");
  const todayHtml = f.today
    .slice(0, 12)
    .map(
      (a) =>
        `<li style="margin:0 0 4px">${esc(tzTime(a.startAt, f.timeZone))} · ${esc(a.customerName?.trim() || "Customer")}${a.service ? ` · ${esc(a.service)}` : ""}</li>`,
    )
    .join("");
  const cancelHtml = f.cancellations
    .slice(0, 5)
    .map(
      (a) =>
        `<li style="margin:0 0 4px">${esc(a.customerName?.trim() || "Customer")}${a.service ? ` · ${esc(a.service)}` : ""} (was ${esc(tzTime(a.startAt, f.timeZone))}, ${esc(tzDayKey(a.startAt, f.timeZone))})</li>`,
    )
    .join("");

  const section = (title: string, body: string) =>
    `<h3 style="margin:18px 0 8px;font-size:15px">${title}</h3>${body}`;

  const html = quiet
    ? `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px">
  <h2 style="margin:0 0 2px;font-size:18px">☀️ Good morning</h2>
  <p style="color:#666;margin:0 0 14px">${esc(f.businessName)} · ${esc(dayLabel)}</p>
  <p style="font-size:15px;margin:0 0 14px">${esc(opening)}</p>
  <p style="color:#999;font-size:12px;margin-top:18px">Daily briefing from your AI receptionist · <a href="${esc(settingsLink)}" style="color:#999">Turn off or change</a></p>
</div>`
    : `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px">
  <h2 style="margin:0 0 2px;font-size:18px">☀️ Good morning</h2>
  <p style="color:#666;margin:0 0 14px">${esc(f.businessName)} · ${esc(dayLabel)}</p>
  <p style="font-size:15px;margin:0 0 14px">${esc(opening)}</p>
  ${callbacks.length ? section(`Call back (${callbacks.length})`, `<ul style="padding-left:18px;margin:0">${cbHtml}</ul>${callbacks.length > 8 ? `<p style="font-size:13px;color:#666">+ ${callbacks.length - 8} more in <a href="${base}/portal/leads">Leads</a></p>` : ""}`) : ""}
  ${section(
    `Today (${f.today.length})`,
    f.today.length
      ? `<ul style="padding-left:18px;margin:0">${todayHtml}</ul>`
      : `<p style="margin:0;color:#666">Nothing booked today.</p>`,
  )}
  ${section(
    "Yesterday",
    `<p style="margin:0;color:#444;font-size:14px">${plural(c.calls, "call", "calls")} answered · ${plural(c.bookingsMade, "new booking", "new bookings")} · ${plural(c.cancellations, "cancellation", "cancellations")} · ${plural(c.messages, "message", "messages")} · ${c.afterHours} after hours${c.spam ? ` · ${c.spam} spam` : ""}</p>${
      cancelHtml ? `<ul style="padding-left:18px;margin:8px 0 0;color:#444;font-size:14px">${cancelHtml}</ul>` : ""
    }`,
  )}
  <p style="margin:18px 0 0"><a href="${base}/portal" style="background:#111;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:14px;display:inline-block">Open your dashboard</a></p>
  <p style="color:#999;font-size:12px;margin-top:18px">Written by your AI receptionist from your call log — names, numbers and times come straight from your records. <a href="${esc(settingsLink)}" style="color:#999">Turn off or change</a></p>
</div>`;

  const text = [
    `Good morning — ${f.businessName}, ${dayLabel}`,
    opening,
    callbacks.length
      ? `CALL BACK (${callbacks.length}):\n${callbacks
          .slice(0, 8)
          .map(
            (cb) =>
              `- ${cb.urgent ? "URGENT " : ""}${cb.who}${cb.phone && cb.phone !== cb.who ? ` (${cb.phone})` : ""}: ${cb.what}${cb.note ? ` — ${cb.note}` : ""}${cb.link ? ` ${cb.link}` : ""}`,
          )
          .join("\n")}`
      : "",
    quiet
      ? ""
      : `TODAY (${f.today.length}):\n${
          f.today.length
            ? f.today
                .slice(0, 12)
                .map((a) => `- ${tzTime(a.startAt, f.timeZone)} ${a.customerName?.trim() || "Customer"}${a.service ? ` · ${a.service}` : ""}`)
                .join("\n")
            : "Nothing booked today."
        }`,
    quiet
      ? ""
      : `YESTERDAY: ${plural(c.calls, "call", "calls")} answered, ${plural(c.bookingsMade, "new booking", "new bookings")}, ${plural(c.cancellations, "cancellation", "cancellations")}, ${plural(c.messages, "message", "messages")}.`,
    `Dashboard: ${base}/portal`,
    `Turn off or change: ${settingsLink}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    subject,
    html,
    text,
    card: {
      dayKey: f.dayKey,
      opening,
      quiet,
      callbacks: callbacks.slice(0, 5).map(({ who, what, note, urgent, link }) => ({ who, what, note, urgent, link })),
      todayCount: f.today.length,
      calls: c.calls,
      bookingsMade: c.bookingsMade,
      cancellations: c.cancellations,
    },
  };
}

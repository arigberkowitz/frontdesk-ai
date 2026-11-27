/**
 * The blocked-caller list, and the decision about who belongs on it.
 *
 * We already count robocalls for each business. Counting them is where every
 * other product stops — the roofing contractor whose cancellation is the
 * most-quoted in this market worked out for himself that 70% of his billed
 * minutes were spam and ring time, and his vendor's answer was to suggest a
 * higher tier. Counting a problem you won't fix is worse than not counting it.
 *
 * So: a number the business has blocked never reaches the agent's ears, never
 * becomes a lead, never sets off an alert, and never lands in the numbers a
 * business is asked to trust.
 *
 * Pure and client-safe. The rules about who gets blocked are the kind of thing
 * that should be arguable in a test, not buried in a query.
 */

/** Last ten digits — the only comparison that survives +1, spaces and dashes. */
export function normalizeForBlock(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export function isBlocked(phone: string | null | undefined, blocked: string[]): boolean {
  const key = normalizeForBlock(phone);
  if (!key) return false;
  return blocked.some((b) => normalizeForBlock(b) === key);
}

/** Add a number, ignoring duplicates and anything unparseable. Newest first. */
export function addBlocked(phone: string, blocked: string[]): string[] {
  const key = normalizeForBlock(phone);
  if (!key) return blocked;
  const without = blocked.filter((b) => normalizeForBlock(b) !== key);
  return [key, ...without].slice(0, MAX_BLOCKED);
}

export function removeBlocked(phone: string, blocked: string[]): string[] {
  const key = normalizeForBlock(phone);
  return blocked.filter((b) => normalizeForBlock(b) !== key);
}

/**
 * A cap, because this lives in a jsonb column and because a business with two
 * hundred blocked numbers has a different problem that a list won't fix.
 */
export const MAX_BLOCKED = 100;

export interface SpamCandidate {
  phone: string;
  calls: number;
  lastAt: Date | null;
}

/**
 * Who to offer for blocking: numbers already classified as spam that called
 * more than once.
 *
 * Once is a wrong number. Twice is a dialer. The threshold is deliberately not
 * one — blocking a real customer because a single call got misclassified is a
 * far worse outcome than one extra robocall, and the business can always block
 * a single number by hand from the call log.
 */
export function spamCandidates(
  calls: Array<{ fromNumber: string | null; outcome: string | null; startAt: Date | null }>,
  alreadyBlocked: string[],
  minCalls = 2,
): SpamCandidate[] {
  const byNumber = new Map<string, { calls: number; lastAt: Date | null }>();

  for (const call of calls) {
    if (call.outcome !== "spam") continue;
    const key = normalizeForBlock(call.fromNumber);
    if (!key) continue;
    if (isBlocked(key, alreadyBlocked)) continue;
    const entry = byNumber.get(key) ?? { calls: 0, lastAt: null };
    entry.calls += 1;
    if (call.startAt && (!entry.lastAt || call.startAt > entry.lastAt)) entry.lastAt = call.startAt;
    byNumber.set(key, entry);
  }

  return [...byNumber.entries()]
    .filter(([, v]) => v.calls >= minCalls)
    .map(([phone, v]) => ({ phone, calls: v.calls, lastAt: v.lastAt }))
    .sort((a, b) => b.calls - a.calls);
}

/* ------------------------------------------------------------------------ */
/* Screening a call before the AI picks up (Retell's inbound webhook).       */
/* ------------------------------------------------------------------------ */

/**
 * A number that our own call log has classified as spam this many times in
 * the window is turned away before the AI answers, without the owner doing
 * anything. Three, not two: two is where we *suggest* blocking (above), and
 * the gap is deliberate — a real customer whose calls were misread as spam
 * twice is still answered, and the owner is shown the number first.
 */
export const AUTO_REJECT_SPAM_CALLS = 3;
/** How far back the caller's history is read. Older spam ages out by itself. */
export const SCREEN_WINDOW_DAYS = 30;

/** What we know about earlier calls from this number to this business. */
export interface CallerHistoryRow {
  outcome: string | null;
  /** A lead or an appointment came out of the call. */
  hasContact: boolean;
}

export type InboundScreen =
  | { reject: false; reason: null }
  | { reject: true; reason: "blocked" | "repeat_spam" };

/** Outcomes that mean a real person got something done. Any one clears the number for good. */
const REAL_OUTCOMES = new Set(["booked", "lead", "escalated"]);

/**
 * Turn the call away before the AI starts, or let it through.
 *
 * - A number the owner blocked: always turned away.
 * - A number our log classified as spam AUTO_REJECT_SPAM_CALLS+ times in the
 *   window, and that never once booked, left a message or reached a person:
 *   turned away. One real outcome and it is answered forever after.
 * - Everything else, including withheld or unparseable caller IDs (real
 *   people hide their number too), and anything the owner let through
 *   (`allowed`): answered.
 */
export function screenInboundCaller(
  fromNumber: string | null | undefined,
  blocked: string[],
  history: CallerHistoryRow[],
  allowed: string[] = [],
): InboundScreen {
  if (!normalizeForBlock(fromNumber)) return { reject: false, reason: null };
  if (isBlocked(fromNumber, blocked)) return { reject: true, reason: "blocked" };
  // The owner said "let them through": the automatic rule never applies again.
  if (isBlocked(fromNumber, allowed)) return { reject: false, reason: null };
  if (history.some((h) => h.hasContact || (h.outcome !== null && REAL_OUTCOMES.has(h.outcome)))) {
    return { reject: false, reason: null };
  }
  const spam = history.filter((h) => h.outcome === "spam").length;
  if (spam >= AUTO_REJECT_SPAM_CALLS) return { reject: true, reason: "repeat_spam" };
  return { reject: false, reason: null };
}

/* ------------------------------------------------------------------------ */
/* Repeat silent / very short callers — suggested to the owner, never auto.  */
/* ------------------------------------------------------------------------ */

/** A call this short, or one where the caller never said a word, counts as silent. */
export const SILENT_CALL_MAX_SEC = 10;
/** Silent calls from one number before we suggest blocking it. */
export const SILENT_REPEAT_MIN_CALLS = 3;

/** True when the caller never spoke (no "User:" turn) or the call was over in SILENT_CALL_MAX_SEC. */
export function isSilentOrShort(c: { durationSec: number | null; transcript: string | null }): boolean {
  if (c.durationSec !== null && c.durationSec <= SILENT_CALL_MAX_SEC) return true;
  if (c.transcript !== null && c.durationSec !== null && !/^\s*User\s*:/im.test(c.transcript)) return true;
  return false;
}

/**
 * Numbers that keep calling and saying nothing: SILENT_REPEAT_MIN_CALLS+
 * silent or very short calls, and not one call from that number with a real
 * conversation, a lead or a booking. Only ever a suggestion — a pocket dial
 * from a regular customer, or someone with a bad line, looks exactly like this
 * a few times, which is why this never blocks on its own.
 */
export function silentRepeatCandidates(
  calls: Array<{
    fromNumber: string | null;
    durationSec: number | null;
    transcript: string | null;
    hasContact: boolean;
    startAt: Date | null;
  }>,
  alreadyBlocked: string[],
  minCalls = SILENT_REPEAT_MIN_CALLS,
): SpamCandidate[] {
  const byNumber = new Map<string, { silent: number; real: boolean; lastAt: Date | null }>();
  for (const call of calls) {
    const key = normalizeForBlock(call.fromNumber);
    if (!key || isBlocked(key, alreadyBlocked)) continue;
    const entry = byNumber.get(key) ?? { silent: 0, real: false, lastAt: null };
    if (call.hasContact || !isSilentOrShort(call)) entry.real = true;
    else entry.silent += 1;
    if (call.startAt && (!entry.lastAt || call.startAt > entry.lastAt)) entry.lastAt = call.startAt;
    byNumber.set(key, entry);
  }
  return [...byNumber.entries()]
    .filter(([, v]) => !v.real && v.silent >= minCalls)
    .map(([phone, v]) => ({ phone, calls: v.silent, lastAt: v.lastAt }))
    .sort((a, b) => b.calls - a.calls);
}

/**
 * The numbers the automatic rule is turning away right now, for the owner to
 * see and, with one tap, let through. Same rule as screenInboundCaller, read
 * off the call log the Overview already loads.
 */
export function autoRejectedNumbers(
  calls: Array<{ fromNumber: string | null; outcome: string | null; hasContact: boolean; startAt: Date | null }>,
  blocked: string[],
  allowed: string[],
): SpamCandidate[] {
  const byNumber = new Map<string, { rows: CallerHistoryRow[]; spam: number; lastAt: Date | null }>();
  for (const call of calls) {
    const key = normalizeForBlock(call.fromNumber);
    if (!key) continue;
    const entry = byNumber.get(key) ?? { rows: [], spam: 0, lastAt: null };
    entry.rows.push({ outcome: call.outcome, hasContact: call.hasContact });
    if (call.outcome === "spam") entry.spam += 1;
    if (call.startAt && (!entry.lastAt || call.startAt > entry.lastAt)) entry.lastAt = call.startAt;
    byNumber.set(key, entry);
  }
  return [...byNumber.entries()]
    .filter(([phone, v]) => screenInboundCaller(phone, blocked, v.rows, allowed).reason === "repeat_spam")
    .map(([phone, v]) => ({ phone, calls: v.spam, lastAt: v.lastAt }))
    .sort((a, b) => b.calls - a.calls);
}

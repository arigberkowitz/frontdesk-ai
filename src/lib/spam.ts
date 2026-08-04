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

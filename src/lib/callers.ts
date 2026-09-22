/**
 * Repeat-caller recognition.
 *
 * A receptionist who's been there a month knows "that's Sam, third time this
 * week". The call log should too: the name we already captured for a number
 * (from a booking or a message), and how many times it has called before.
 *
 * Pure — the index is built from rows the page already loaded.
 */

export interface CallerInfo {
  /** Best name we have for this number, from a booking or a lead. */
  name: string | null;
  /** Call ids from this number, oldest first. */
  callIds: string[];
}

/** A serializable index: caller key → info. Keys come from `callerKey`. */
export type CallerIndex = Record<string, CallerInfo>;

/** Last ten digits — the same normalization the block list uses, so "(415)
 *  555-0100", "+14155550100" and "4155550100" are one caller. */
export function callerKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/** The number on the other end, whichever way the call went. */
export function otherParty(call: { direction: string; fromNumber: string | null; toNumber: string | null }): string | null {
  return call.direction === "outbound" ? call.toNumber : call.fromNumber;
}

export function buildCallerIndex(
  calls: { id: string; direction: string; fromNumber: string | null; toNumber: string | null; startAt: Date | null }[],
  names: { phone: string | null; name: string | null }[],
): CallerIndex {
  const index: CallerIndex = {};
  const sorted = [...calls].sort(
    (a, b) => (a.startAt?.getTime() ?? 0) - (b.startAt?.getTime() ?? 0),
  );
  for (const c of sorted) {
    const key = callerKey(otherParty(c));
    if (!key) continue;
    (index[key] ??= { name: null, callIds: [] }).callIds.push(c.id);
  }
  // `names` arrives most-recent-first; the first usable name for a key wins.
  for (const n of names) {
    const key = callerKey(n.phone);
    const name = n.name?.trim();
    if (!key || !name) continue;
    const entry = index[key];
    if (entry && !entry.name) entry.name = name;
  }
  return index;
}

/** How many calls from this number came before this one. */
export function priorCalls(index: CallerIndex, call: { id: string; direction: string; fromNumber: string | null; toNumber: string | null }): number {
  const key = callerKey(otherParty(call));
  if (!key) return 0;
  const i = index[key]?.callIds.indexOf(call.id) ?? -1;
  return i > 0 ? i : 0;
}

export function callerName(index: CallerIndex, phone: string | null | undefined): string | null {
  const key = callerKey(phone);
  return key ? (index[key]?.name ?? null) : null;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

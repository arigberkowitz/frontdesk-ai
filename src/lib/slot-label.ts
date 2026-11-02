/**
 * Present a UTC slot instant in the business's own zone.
 *
 * check-availability used to hand the model bare UTC strings
 * ("2026-10-14T16:00:00.000Z"). The model read the clock digits literally, so
 * 9 AM PT came out as "4:00 PM", and late-evening PT dates rolled to the next
 * UTC day. Give it a local ISO with offset plus a human label instead.
 */
export function localSlot(startAt: string, timeZone: string): { start: string; label: string } {
  const d = new Date(startAt);
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
  }).formatToParts(d)) parts[p.type] = p.value;
  const off = parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName.replace("GMT", "");
  const start = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00${off}`;
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(d);
  return { start, label };
}

/**
 * "Thursday, October 15, 2026 at 10:00 AM" in the business's zone, for tool
 * messages the model repeats back. formatDateTime ("Oct 15, 2026, 10:00 AM")
 * carries no weekday, so the model filled one in itself and got it wrong
 * (prod Oct 14: "Tuesday, October 15" for a Thursday). Always spell it out.
 */
export function spokenDateTime(value: Date | string, timeZone: string): string {
  const d = value instanceof Date ? value : new Date(value);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
  return `${date} at ${time}`;
}

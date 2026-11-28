/**
 * The pitch on the locked website-chat card (Rescue / Starter).
 *
 * Real counts only. With an after-hours count from the call log, it says that
 * number; with none (no hours saved, nothing logged yet, or zero), it says a
 * plain line with no number in it. Pure, so the wording is tested.
 */
export function websiteChatTeaser(afterHoursCalls: number | null, days = 30): string {
  const pitch = "Pro adds a chat that answers your website visitors at night too.";
  if (afterHoursCalls && afterHoursCalls > 0) {
    const who = afterHoursCalls === 1 ? "1 person" : `${afterHoursCalls.toLocaleString("en-US")} people`;
    return `Your website is closed when you are. ${who} called after hours in the last ${days} days, and ${pitch}`;
  }
  return `Your website is closed when you are. ${pitch}`;
}

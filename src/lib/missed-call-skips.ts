/**
 * Why a caller didn't get a missed-call text-back, in the owner's words.
 * Client-safe. Keys are the `skip_reason` values missed-call-callback.ts writes.
 */
export const MISSED_CALL_SKIP_LABELS: Record<string, string> = {
  no_consent: "hadn't agreed to texts from you",
  already_booked: "were already booked",
  called_again: "called back on their own",
  opted_out: "had replied STOP",
  too_old: "were too long ago to text",
  daily_cap: "came after the daily limit",
  feature_off: "came while this was off",
  sms_not_configured: "came before texting was set up",
  missing: "couldn't be matched to a call",
};

/** Largest first, with labels; unknown reasons fall under "other reasons". */
export function skipBreakdown(skippedBy: Record<string, number>): { reason: string; label: string; count: number }[] {
  return Object.entries(skippedBy)
    .filter(([, n]) => n > 0)
    .map(([reason, count]) => ({ reason, label: MISSED_CALL_SKIP_LABELS[reason] ?? "were skipped for other reasons", count }))
    .sort((a, b) => b.count - a.count);
}

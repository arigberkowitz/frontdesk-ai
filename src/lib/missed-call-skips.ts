/**
 * Why a caller didn't get a missed-call text-back, in the owner's words.
 * Client-safe. Keys are the `skip_reason` values missed-call-callback.ts writes.
 */
export const MISSED_CALL_SKIP_LABELS: Record<string, string> = {
  no_consent: "Hadn't agreed to texts from you",
  already_booked: "Already booked",
  called_again: "Called back on their own",
  opted_out: "Had replied STOP",
  too_old: "Too long ago to text",
  daily_cap: "Over the daily limit",
  feature_off: "Came in while this was off",
  sms_not_configured: "Texting isn't switched on yet",
  missing: "Couldn't be matched to a call",
};

/** Largest first, with labels; unknown reasons fall under "other reasons". */
export function skipBreakdown(skippedBy: Record<string, number>): { reason: string; label: string; count: number }[] {
  return Object.entries(skippedBy)
    .filter(([, n]) => n > 0)
    .map(([reason, count]) => ({ reason, label: MISSED_CALL_SKIP_LABELS[reason] ?? "Other reasons", count }))
    .sort((a, b) => b.count - a.count);
}

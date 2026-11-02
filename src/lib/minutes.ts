/**
 * Minutes used against a plan's included minutes — pure, client-safe.
 * The cap is soft (no overage charges, calls never cut off); this is what the
 * owner sees so a cap is never a surprise.
 */
export interface MinutesUsage {
  usedMinutes: number;
  includedMinutes: number | null;
  /** 0–100, or null when unlimited. */
  percent: number | null;
  tone: "ok" | "near" | "over";
  text: string;
}

export function minutesUsage(usedSeconds: number, includedMinutes: number | null): MinutesUsage {
  const usedMinutes = Math.ceil(Math.max(0, usedSeconds) / 60);
  if (includedMinutes === null) {
    return { usedMinutes, includedMinutes, percent: null, tone: "ok", text: `${usedMinutes} minutes used this period · unlimited` };
  }
  const percent = Math.min(100, Math.round((usedMinutes / includedMinutes) * 100));
  const tone = usedMinutes >= includedMinutes ? "over" : percent >= 80 ? "near" : "ok";
  const tail =
    tone === "over"
      ? " · you're past your included minutes. Calls still get answered and there's no overage charge, but upgrading keeps you covered."
      : tone === "near"
        ? " · getting close to your included minutes"
        : "";
  return { usedMinutes, includedMinutes, percent, tone, text: `${usedMinutes} of ${includedMinutes} minutes used this period${tail}` };
}

/** Start of the current billing period, from Stripe's period end (monthly or yearly). */
export function periodStart(currentPeriodEnd: Date | null, now: Date = new Date()): Date {
  if (!currentPeriodEnd) return new Date(now.getTime() - 30 * 86_400_000);
  const start = new Date(currentPeriodEnd);
  start.setUTCMonth(start.getUTCMonth() - 1);
  while (start > now) start.setUTCMonth(start.getUTCMonth() - 1);
  return start;
}

/**
 * "This week vs last week", from a 14-day daily series.
 *
 * Pure, so the tiles' verdicts are testable. The rule that matters: a
 * business with no history gets *no* arrow. "↑ 100%" over a week of zeros is
 * the kind of number that makes every other number look made up.
 */

export type TrendTone = "up" | "down" | "flat";

export interface Trend {
  /** Sum of the most recent 7 points. */
  current: number;
  /** Sum of the 7 before that. */
  previous: number;
  /** Percent change, or null when there's nothing to compare against. */
  pct: number | null;
  tone: TrendTone;
  /** Ready to print: "↑ 40% vs last week". */
  text: string;
}

/** `higherIsBetter=false` flips the colour, not the arrow — fewer is still "down". */
export function weekOverWeek(series: number[], format: (n: number) => string = String): Trend | null {
  if (series.length < 14) return null;
  const last7 = series.slice(-7);
  const prior7 = series.slice(-14, -7);
  const current = last7.reduce((a, b) => a + b, 0);
  const previous = prior7.reduce((a, b) => a + b, 0);

  if (current === 0 && previous === 0) return null;

  if (previous === 0) {
    return {
      current,
      previous,
      pct: null,
      tone: "up",
      text: `${format(current)} this week — first week with any`,
    };
  }

  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) {
    return { current, previous, pct, tone: "flat", text: "Same as last week" };
  }
  const arrow = pct > 0 ? "↑" : "↓";
  return {
    current,
    previous,
    pct,
    tone: pct > 0 ? "up" : "down",
    text: `${arrow} ${Math.abs(pct)}% vs last week`,
  };
}

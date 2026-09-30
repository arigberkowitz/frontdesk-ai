/**
 * Pure helpers for the Overview hero (greeting + "today" numbers). Display
 * only: everything here reads data the Overview already loads.
 */

/** Hour of day (0-23) at `at` in the business's timezone. */
export function hourInZone(at: Date, timeZone?: string | null): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timeZone || undefined,
    }).format(at);
    return Number(h) % 24;
  } catch {
    return at.getHours();
  }
}

export function greetingForHour(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Calendar day (YYYY-MM-DD) of `at` in the business's timezone. */
export function dayKeyInZone(at: Date, timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timeZone || undefined,
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** How many of `dates` fall on the same business-local day as `now`. */
export function countOnDay(
  dates: (Date | null | undefined)[],
  now: Date,
  timeZone?: string | null,
): number {
  const today = dayKeyInZone(now, timeZone);
  return dates.filter((d) => d && dayKeyInZone(d, timeZone) === today).length;
}

export type HeroStatusTone = "live" | "paused" | "setup";

/** The one-line status under the greeting, from data the Overview already has. */
export function heroStatus(input: {
  clientStatus?: string | null;
  aiLive: boolean;
  setupDone: number;
  setupTotal: number;
}): { tone: HeroStatusTone; label: string } {
  if (input.clientStatus === "paused") {
    return { tone: "paused", label: "Your AI receptionist is paused" };
  }
  if (input.aiLive) {
    return { tone: "live", label: "Your AI receptionist is live" };
  }
  return {
    tone: "setup",
    label: `Finish setup to go live · ${input.setupDone} of ${input.setupTotal} done`,
  };
}

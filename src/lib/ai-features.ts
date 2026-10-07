/**
 * The Overview "AI features" switchboard — the pure part. Turns each
 * feature's on/off flag and its recent counts into the one-line status the
 * owner sees ("Answered 3 texts this week"). No DB, no server-only, so the
 * copy rules are unit-tested.
 *
 * Honesty rules: a count we couldn't load is `null` and says nothing rather
 * than "0"; a feature that's off never shows activity numbers; zero reads as
 * "nothing yet", never as a made-up success.
 */

export type AiFeatureKey = "aiTextReplies" | "missedCallTexts" | "smartRebooking" | "dailyBriefing";

export interface AiFeatureStats {
  /** AI-written texts sent in the last 7 days (kind ai_reply, not failed). */
  aiReplies7d: number | null;
  /** Conversations the AI handed to the owner in the last 7 days. */
  aiHandoffs7d: number | null;
  /** Missed-call follow-ups in the last 7 days. */
  callbacks7d: { sent: number; pending: number; failed: number } | null;
  /** Rebooking offers in the last 30 days. */
  rebook30d: { sent: number; rebooked: number } | null;
  /** When the last morning briefing email actually went out. */
  lastBriefingSentAt: Date | null;
}

export const EMPTY_AI_FEATURE_STATS: AiFeatureStats = {
  aiReplies7d: null,
  aiHandoffs7d: null,
  callbacks7d: null,
  rebook30d: null,
  lastBriefingSentAt: null,
};

export interface AiFeatureFlags {
  aiTextRepliesEnabled: boolean;
  missedCallTextsEnabled: boolean;
  missedCallAiCallbacksEnabled: boolean;
  smartRebookingEnabled: boolean;
  dailyBriefingEnabled: boolean;
  /** Where the briefing is emailed; without one, nothing can be sent. */
  ownerEmail: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "today" / "yesterday" / "Mon, Oct 5" in the business's timezone. */
export function relativeDay(at: Date, now: Date, timeZone: string): string {
  const key = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  if (key(at) === key(now)) return "today";
  if (key(at) === key(new Date(now.getTime() - 86_400_000))) return "yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(at);
}

export interface FeatureStatus {
  /** "on" = active, "off" = switched off, "warn" = on but something stops it working. */
  tone: "on" | "off" | "warn";
  text: string;
}

export function aiFeatureStatus(
  key: AiFeatureKey,
  flags: AiFeatureFlags,
  stats: AiFeatureStats,
  opts: { now?: Date; timeZone?: string } = {},
): FeatureStatus {
  const now = opts.now ?? new Date();
  const tz = opts.timeZone ?? "America/New_York";
  switch (key) {
    case "aiTextReplies": {
      if (!flags.aiTextRepliesEnabled) return { tone: "off", text: "Off · customer texts come to you" };
      if (stats.aiReplies7d == null) return { tone: "on", text: "On" };
      if (stats.aiReplies7d === 0) return { tone: "on", text: "On · no texts to answer this week yet" };
      const handoffs = stats.aiHandoffs7d ? ` · passed ${stats.aiHandoffs7d} to you` : "";
      return { tone: "on", text: `Handled ${plural(stats.aiReplies7d, "text")} this week${handoffs}` };
    }
    case "missedCallTexts": {
      if (!flags.missedCallTextsEnabled) return { tone: "off", text: "Off · nobody is texted after a missed call" };
      const c = stats.callbacks7d;
      if (!c) return { tone: "on", text: "On" };
      if (c.sent === 0 && c.pending === 0 && c.failed === 0) {
        return { tone: "on", text: "On · no missed or dropped calls needed one this week" };
      }
      const parts = [`Followed up ${plural(c.sent, "caller")} this week`];
      if (c.pending) parts.push(`${c.pending} waiting for daytime`);
      if (c.failed) parts.push(`${c.failed} failed`);
      return { tone: c.failed && !c.sent ? "warn" : "on", text: parts.join(" · ") };
    }
    case "smartRebooking": {
      if (!flags.smartRebookingEnabled) return { tone: "off", text: "Off · no rebooking texts" };
      const r = stats.rebook30d;
      if (!r) return { tone: "on", text: "On" };
      if (r.sent === 0) return { tone: "on", text: "On · you pick who to text when you block time" };
      return {
        tone: "on",
        text: `Offered new times to ${plural(r.sent, "customer")} in 30 days · ${r.rebooked} rebooked`,
      };
    }
    case "dailyBriefing": {
      if (!flags.dailyBriefingEnabled) return { tone: "off", text: "Off · no morning email" };
      if (!flags.ownerEmail?.trim()) {
        return { tone: "warn", text: "On, but there's no alerts email to send it to" };
      }
      if (stats.lastBriefingSentAt) {
        return { tone: "on", text: `Last sent ${relativeDay(stats.lastBriefingSentAt, now, tz)}` };
      }
      return { tone: "on", text: "On · the first one arrives the next morning, 7–10am" };
    }
  }
}

export type SwitchKey = AiFeatureKey | "aiCallbacks";

/**
 * The exact fields each Overview switch posts to its EXISTING server action,
 * shaped like the Settings forms: a checked box sends "on", an unchecked one
 * sends nothing.
 *  - AI text replies keeps the owner's saved pause length (the action saves both).
 *  - The missed-call switch never sends `aiCallbacks`, so flipping it can't
 *    switch the AI phone callback on; the call-back has its own switch, which
 *    always sends texts-on with it (the action requires both).
 *  - The briefing posts only `dailyBriefingEnabled`, so the profile action
 *    patches that one flag and nothing else.
 */
export function switchboardFields(
  key: SwitchKey,
  clientId: string,
  on: boolean,
  opts: { pauseHours?: number } = {},
): Record<string, string> {
  const checked = (name: string): Record<string, string> => (on ? { [name]: "on" } : {});
  switch (key) {
    case "aiTextReplies":
      return { clientId, ...checked("enabled"), pauseHours: String(opts.pauseHours ?? 12) };
    case "missedCallTexts":
    case "smartRebooking":
      return { clientId, ...checked("enabled") };
    case "aiCallbacks":
      return { clientId, enabled: "on", ...checked("aiCallbacks") };
    case "dailyBriefing":
      return { clientId, dailyBriefingEnabled: on ? "on" : "off" };
  }
}

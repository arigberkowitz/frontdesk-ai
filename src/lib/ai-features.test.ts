import { describe, expect, it } from "vitest";
import {
  EMPTY_AI_FEATURE_STATS,
  aiFeatureStatus,
  relativeDay,
  switchboardFields,
  type AiFeatureFlags,
  type AiFeatureStats,
} from "./ai-features";

const off: AiFeatureFlags = {
  aiTextRepliesEnabled: false,
  missedCallTextsEnabled: false,
  missedCallAiCallbacksEnabled: false,
  smartRebookingEnabled: false,
  dailyBriefingEnabled: false,
  ownerEmail: "owner@biz.test",
};
const on: AiFeatureFlags = {
  ...off,
  aiTextRepliesEnabled: true,
  missedCallTextsEnabled: true,
  smartRebookingEnabled: true,
  dailyBriefingEnabled: true,
};
const stats = (s: Partial<AiFeatureStats>): AiFeatureStats => ({ ...EMPTY_AI_FEATURE_STATS, ...s });
const now = new Date("2026-10-07T16:00:00Z"); // noon ET
const opts = { now, timeZone: "America/New_York" };

describe("aiFeatureStatus", () => {
  it("an off feature never shows activity numbers", () => {
    const busy = stats({
      aiReplies7d: 9,
      callbacks7d: { sent: 4, pending: 0, failed: 0 },
      rebook30d: { sent: 3, rebooked: 2 },
      lastBriefingSentAt: now,
    });
    for (const key of ["aiTextReplies", "missedCallTexts", "smartRebooking", "dailyBriefing"] as const) {
      const s = aiFeatureStatus(key, off, busy, opts);
      expect(s.tone).toBe("off");
      expect(s.text).toMatch(/^Off/);
      expect(s.text).not.toMatch(/\d/);
    }
  });

  it("AI text replies: counts this week's AI texts and handoffs", () => {
    expect(aiFeatureStatus("aiTextReplies", on, stats({ aiReplies7d: 3, aiHandoffs7d: 0 }), opts).text).toBe(
      "Handled 3 texts this week",
    );
    expect(aiFeatureStatus("aiTextReplies", on, stats({ aiReplies7d: 1, aiHandoffs7d: 2 }), opts).text).toBe(
      "Handled 1 text this week · passed 2 to you",
    );
  });

  it("zero reads as 'nothing yet', and an unknown count says nothing", () => {
    expect(aiFeatureStatus("aiTextReplies", on, stats({ aiReplies7d: 0 }), opts).text).toBe(
      "On · no texts to answer this week yet",
    );
    expect(aiFeatureStatus("aiTextReplies", on, stats({ aiReplies7d: null }), opts).text).toBe("On");
    expect(aiFeatureStatus("missedCallTexts", on, stats({ callbacks7d: null }), opts).text).toBe("On");
    expect(
      aiFeatureStatus("missedCallTexts", on, stats({ callbacks7d: { sent: 0, pending: 0, failed: 0 } }), opts).text,
    ).toBe("On · no missed or dropped calls needed one this week");
  });

  it("missed-call: sent, waiting and failed", () => {
    expect(
      aiFeatureStatus("missedCallTexts", on, stats({ callbacks7d: { sent: 2, pending: 1, failed: 1 } }), opts),
    ).toEqual({ tone: "on", text: "Followed up 2 callers this week · 1 waiting for daytime · 1 failed" });
    // Only failures → a warning, not a green dot.
    expect(
      aiFeatureStatus("missedCallTexts", on, stats({ callbacks7d: { sent: 0, pending: 0, failed: 2 } }), opts).tone,
    ).toBe("warn");
  });

  it("smart rebooking: offers and rebooks over 30 days", () => {
    expect(aiFeatureStatus("smartRebooking", on, stats({ rebook30d: { sent: 0, rebooked: 0 } }), opts).text).toBe(
      "On · you pick who to text when you block time",
    );
    expect(aiFeatureStatus("smartRebooking", on, stats({ rebook30d: { sent: 3, rebooked: 2 } }), opts).text).toBe(
      "Offered new times to 3 customers in 30 days · 2 rebooked",
    );
  });

  it("morning briefing: last sent, first one, or no email to send to", () => {
    expect(aiFeatureStatus("dailyBriefing", on, stats({ lastBriefingSentAt: now }), opts).text).toBe("Last sent today");
    expect(aiFeatureStatus("dailyBriefing", on, stats({}), opts).text).toMatch(/first one arrives/);
    expect(aiFeatureStatus("dailyBriefing", { ...on, ownerEmail: " " }, stats({}), opts)).toEqual({
      tone: "warn",
      text: "On, but there's no alerts email to send it to",
    });
  });
});

describe("relativeDay", () => {
  it("uses the business's calendar day", () => {
    const tz = "America/New_York";
    expect(relativeDay(new Date("2026-10-07T11:00:00Z"), now, tz)).toBe("today");
    // 11pm ET on the 6th is 03:00Z on the 7th — still "yesterday" for the business.
    expect(relativeDay(new Date("2026-10-07T03:00:00Z"), now, tz)).toBe("yesterday");
    expect(relativeDay(new Date("2026-10-03T15:00:00Z"), now, tz)).toBe("Sat, Oct 3");
  });
});

describe("switchboardFields", () => {
  it("posts what the Settings forms post: 'on' when checked, nothing when not", () => {
    expect(switchboardFields("smartRebooking", "c1", true)).toEqual({ clientId: "c1", enabled: "on" });
    expect(switchboardFields("smartRebooking", "c1", false)).toEqual({ clientId: "c1" });
  });

  it("AI text replies keeps the saved pause length", () => {
    expect(switchboardFields("aiTextReplies", "c1", true, { pauseHours: 24 })).toEqual({
      clientId: "c1",
      enabled: "on",
      pauseHours: "24",
    });
  });

  it("the missed-call switch can never turn the AI phone callback on", () => {
    expect(switchboardFields("missedCallTexts", "c1", true)).not.toHaveProperty("aiCallbacks");
    expect(switchboardFields("aiCallbacks", "c1", true)).toEqual({ clientId: "c1", enabled: "on", aiCallbacks: "on" });
    expect(switchboardFields("aiCallbacks", "c1", false)).toEqual({ clientId: "c1", enabled: "on" });
  });

  it("the briefing switch sends only its own flag (an owner-only profile field)", () => {
    expect(switchboardFields("dailyBriefing", "c1", false)).toEqual({ clientId: "c1", dailyBriefingEnabled: "off" });
  });
});

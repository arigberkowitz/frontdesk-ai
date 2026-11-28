import { describe, expect, it } from "vitest";
import {
  applyFeatureChange,
  FEATURE_EXPLAINERS,
  FEATURE_GROUPS,
  featureFields,
  featureRows,
  type FeatureFacts,
  type FeatureToggleKey,
} from "./feature-toggles";
import { switchboardFields } from "./ai-features";

// The real column defaults (schema.ts): everything that texts a customer is
// off, owner alerts + weekly summary are on, transfers default to "always".
const defaults: FeatureFacts = {
  handoffMode: "always",
  escalationNumber: "+14155550100",
  humanHandoffEnabled: true,
  languages: "en",
  staffModeEnabled: false,
  staffModeAllowed: true,
  aiTextRepliesEnabled: false,
  aiTextPauseHours: 12,
  missedCallTextsEnabled: false,
  missedCallAiCallbacksEnabled: false,
  aiCallbacksAvailable: false,
  smartRebookingEnabled: false,
  outboundRecoveryEnabled: false,
  reviewRequestsEnabled: false,
  reviewUrl: null,
  recallEnabled: false,
  recallServiceCount: 0,
  waitlistEnabled: false,
  depositsEnabled: false,
  depositLinkUrl: null,
  smsAlertsEnabled: true,
  weeklySummaryEnabled: true,
  dailyBriefingEnabled: false,
  morningUnbookedTextEnabled: false,
  ownerEmail: "owner@biz.test",
  chatWidgetEnabled: false,
};
const limits = { repliesPerThreadPerDay: 3, callbackDedupeDays: 7, callbacksPerDay: 50, rebookOfferHours: 48 };
const row = (f: FeatureFacts, key: FeatureToggleKey) => featureRows(f, limits).find((r) => r.key === key);

describe("featureRows", () => {
  it("lists every feature once, each in a known group with a parent that exists", () => {
    const rows = featureRows({ ...defaults, aiCallbacksAvailable: true }, limits);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual((Object.keys(FEATURE_EXPLAINERS) as FeatureToggleKey[]).sort());
    const groups = new Set(FEATURE_GROUPS.map((g) => g.key));
    for (const r of rows) {
      expect(groups.has(r.group)).toBe(true);
      if (r.parent) expect(keys).toContain(r.parent);
    }
  });

  it("mirrors the real defaults: customer texts off, owner alerts on, transfers on", () => {
    const on = featureRows(defaults, limits).filter((r) => r.on).map((r) => r.key);
    expect(on.sort()).toEqual(["offerHuman", "smsAlerts", "transfer", "weeklySummary"].sort());
  });

  it("hides the AI call-back unless the platform allows it", () => {
    expect(row(defaults, "aiCallbacks")).toBeUndefined();
    expect(row({ ...defaults, aiCallbacksAvailable: true }, "aiCallbacks")?.parent).toBe("missedCallTexts");
  });

  it("shows website chat as Pro-locked on cheaper plans, but lets an owner who has it on switch it off", () => {
    const locked = row({ ...defaults, chatWidgetAllowed: false }, "chatWidget");
    expect(locked?.locked?.label).toBe("Upgrade to Pro");
    expect(locked?.locked?.href).toContain("#website-chat");
    const paused = row({ ...defaults, chatWidgetAllowed: false, chatWidgetEnabled: true }, "chatWidget");
    expect(paused?.locked).toBeUndefined();
    expect(paused?.warning?.note).toMatch(/Paused on your website until you're on Pro/);
    expect(row({ ...defaults, chatWidgetAllowed: true }, "chatWidget")?.locked).toBeUndefined();
  });

  it("shows staff mode as locked (not hidden) when the plan lacks it", () => {
    const r = row({ ...defaults, staffModeAllowed: false }, "staffMode");
    expect(r).toBeDefined();
    expect(r?.locked?.note).toMatch(/Pro/);
    // Already on (e.g. before a downgrade): not locked, so it can be switched off.
    expect(row({ ...defaults, staffModeAllowed: false, staffModeEnabled: true }, "staffMode")?.locked).toBeUndefined();
    expect(row(defaults, "staffMode")?.locked).toBeUndefined();
  });

  it("says what's missing before review requests, deposits or recall can turn on", () => {
    expect(row(defaults, "reviewRequests")?.needs).toBeDefined();
    expect(row({ ...defaults, reviewUrl: "https://g.page/r/x" }, "reviewRequests")?.needs).toBeUndefined();
    expect(row(defaults, "deposits")?.needs).toBeDefined();
    expect(row({ ...defaults, depositLinkUrl: "https://square.link/x" }, "deposits")?.needs).toBeUndefined();
    expect(row(defaults, "recall")?.needs).toBeDefined();
    expect(row({ ...defaults, recallServiceCount: 2 }, "recall")?.needs).toBeUndefined();
  });

  it("warns when a transfer is on but there's no number to transfer to", () => {
    expect(row({ ...defaults, escalationNumber: null }, "transfer")?.warning).toBeDefined();
    expect(row(defaults, "transfer")?.warning).toBeUndefined();
    expect(row({ ...defaults, escalationNumber: null, handoffMode: "never" }, "transfer")?.warning).toBeUndefined();
  });

  it("warns when the morning text is on but text alerts are off", () => {
    const f = { ...defaults, morningUnbookedTextEnabled: true, smsAlertsEnabled: false };
    expect(row(f, "morningUnbookedText")?.warning).toBeDefined();
  });

  it("can't remove Spanish from here when calls open in Spanish", () => {
    const r = row({ ...defaults, languages: "es" }, "spanish");
    expect(r?.on).toBe(true);
    expect(r?.fixed).toBeDefined();
    expect(row({ ...defaults, languages: "en-es" }, "spanish")?.fixed).toBeUndefined();
  });

  it("asks before turning on anything that texts or calls customers, not owner-only features", () => {
    const f = { ...defaults, aiCallbacksAvailable: true };
    for (const k of ["aiTextReplies", "missedCallTexts", "aiCallbacks", "smartRebooking", "recoveryTexts"] as const) {
      expect(row(f, k)?.confirmNotes?.length).toBeGreaterThan(0);
    }
    for (const k of ["smsAlerts", "weeklySummary", "dailyBriefing", "morningUnbookedText"] as const) {
      expect(row(f, k)?.confirmNotes).toBeNull();
    }
  });
});

describe("explainers", () => {
  it("every feature has a short what + example, with no medical wording", () => {
    for (const [key, e] of Object.entries(FEATURE_EXPLAINERS)) {
      expect(e.what.length, key).toBeGreaterThan(20);
      expect(e.example.length, key).toBeGreaterThan(20);
      // 1–2 sentences of "what".
      expect(e.what.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length, key).toBeLessThanOrEqual(3);
      expect(`${e.what} ${e.example}`).not.toMatch(/patient|dental|dentist|clinic|medical|doctor|therap/i);
    }
  });
});

describe("featureFields — posts exactly what the existing actions read", () => {
  it("transfers map onto the three handoff modes", () => {
    expect(featureFields("transfer", "c1", false, defaults)).toEqual({ clientId: "c1", mode: "never" });
    expect(featureFields("transfer", "c1", true, defaults)).toEqual({ clientId: "c1", mode: "always" });
    expect(featureFields("transferOpenHoursOnly", "c1", true, defaults)).toEqual({ clientId: "c1", mode: "open_hours" });
    expect(featureFields("transferOpenHoursOnly", "c1", false, defaults)).toEqual({ clientId: "c1", mode: "always" });
  });

  it("profile-action switches send only their own field, as on/off", () => {
    expect(featureFields("offerHuman", "c1", false, defaults)).toEqual({ clientId: "c1", humanHandoffEnabled: "off" });
    expect(featureFields("recoveryTexts", "c1", true, defaults)).toEqual({ clientId: "c1", outboundRecoveryEnabled: "on" });
    expect(featureFields("smsAlerts", "c1", false, defaults)).toEqual({ clientId: "c1", smsAlertsEnabled: "off" });
    expect(featureFields("weeklySummary", "c1", true, defaults)).toEqual({ clientId: "c1", weeklySummaryEnabled: "on" });
  });

  it("AI features reuse the Overview switchboard fields", () => {
    expect(featureFields("aiTextReplies", "c1", true, { ...defaults, aiTextPauseHours: 6 })).toEqual(
      switchboardFields("aiTextReplies", "c1", true, { pauseHours: 6 }),
    );
    for (const k of ["missedCallTexts", "smartRebooking", "dailyBriefing", "morningUnbookedText", "aiCallbacks"] as const) {
      expect(featureFields(k, "c1", true, defaults)).toEqual(switchboardFields(k, "c1", true));
      expect(featureFields(k, "c1", false, defaults)).toEqual(switchboardFields(k, "c1", false));
    }
  });

  it("staff mode posts enabled=true|false like the Staff page", () => {
    expect(featureFields("staffMode", "c1", true, defaults)).toEqual({ clientId: "c1", enabled: "true" });
    expect(featureFields("staffMode", "c1", false, defaults)).toEqual({ clientId: "c1", enabled: "false" });
  });

  it("growth switches send a checkbox, re-sending the saved link so it isn't wiped", () => {
    const f = { ...defaults, reviewUrl: "https://g.page/r/x", depositLinkUrl: "https://square.link/y" };
    expect(featureFields("reviewRequests", "c1", true, f)).toEqual({ clientId: "c1", enabled: "on", reviewUrl: "https://g.page/r/x" });
    expect(featureFields("reviewRequests", "c1", false, f)).toEqual({ clientId: "c1", reviewUrl: "https://g.page/r/x" });
    expect(featureFields("deposits", "c1", false, f)).toEqual({ clientId: "c1", depositLinkUrl: "https://square.link/y" });
    expect(featureFields("waitlist", "c1", true, f)).toEqual({ clientId: "c1", enabled: "on" });
    expect(featureFields("chatWidget", "c1", false, f)).toEqual({ clientId: "c1" });
  });

  it("Spanish adds or removes es and keeps the other languages", () => {
    expect(featureFields("spanish", "c1", true, defaults).languages).toBe("en-es");
    expect(featureFields("spanish", "c1", false, { ...defaults, languages: "en-es" }).languages).toBe("en");
    expect(featureFields("spanish", "c1", true, { ...defaults, languages: "en,fr" }).languages).toBe("en,fr,es");
    expect(featureFields("spanish", "c1", false, { ...defaults, languages: "en,es,fr" }).languages).toBe("en,fr");
  });
});

describe("applyFeatureChange", () => {
  it("keeps sub-switches in step with their parent", () => {
    let f = applyFeatureChange(defaults, "transfer", false);
    expect(row(f, "transfer")?.on).toBe(false);
    f = applyFeatureChange(f, "transfer", true);
    expect(f.handoffMode).toBe("always");
    f = applyFeatureChange(f, "transferOpenHoursOnly", true);
    expect(f.handoffMode).toBe("open_hours");
  });

  it("clears the AI call-back whenever the text-back switch changes, like the server", () => {
    const f = applyFeatureChange(
      { ...defaults, missedCallTextsEnabled: true, missedCallAiCallbacksEnabled: true },
      "missedCallTexts",
      true,
    );
    expect(f.missedCallAiCallbacksEnabled).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { aiFeatureStatus, EMPTY_AI_FEATURE_STATS, SMS_PENDING_TEXT, type AiFeatureFlags } from "./ai-features";
import { alertEmails } from "./alert-emails";
import { parseOwnerCell, signupDefaults } from "./signup-defaults";
import { buildSetupSteps, type SetupFacts } from "./setup-steps";

const flags: AiFeatureFlags = {
  aiTextRepliesEnabled: true,
  missedCallTextsEnabled: true,
  missedCallAiCallbacksEnabled: false,
  smartRebookingEnabled: false,
  dailyBriefingEnabled: true,
  ownerEmail: "o@x.com",
};

describe("texts pending carrier approval", () => {
  it("shows pending for on text features when SMS isn't approved", () => {
    for (const k of ["aiTextReplies", "missedCallTexts"] as const) {
      expect(aiFeatureStatus(k, flags, EMPTY_AI_FEATURE_STATS, { smsEnabled: false })).toEqual({
        tone: "warn",
        text: SMS_PENDING_TEXT,
      });
    }
  });
  it("leaves off features off and email features alone", () => {
    expect(aiFeatureStatus("smartRebooking", flags, EMPTY_AI_FEATURE_STATS, { smsEnabled: false }).tone).toBe("off");
    expect(aiFeatureStatus("dailyBriefing", flags, EMPTY_AI_FEATURE_STATS, { smsEnabled: false }).text).not.toBe(
      SMS_PENDING_TEXT,
    );
  });
  it("normal status once approved", () => {
    expect(aiFeatureStatus("missedCallTexts", flags, EMPTY_AI_FEATURE_STATS, { smsEnabled: true }).tone).toBe("on");
  });
});

describe("owner alerts fall back to email", () => {
  it("adds the owner email while SMS is pending", () => {
    expect(alertEmails(["a@x.com"], "o@x.com", false)).toEqual(["a@x.com", "o@x.com"]);
    expect(alertEmails(["a@x.com"], "o@x.com", true)).toEqual(["a@x.com"]);
    expect(alertEmails([], "o@x.com", true)).toEqual(["o@x.com"]);
    expect(alertEmails([], null, false)).toEqual([]);
  });
});

describe("signup defaults", () => {
  it("turns advertised features on, others untouched", () => {
    const d = signupDefaults(null);
    expect(d).toMatchObject({ missedCallTextsEnabled: true, aiTextRepliesEnabled: true, missedCallAiCallbacksEnabled: true });
    expect(d).not.toHaveProperty("escalationNumber");
    expect(d).not.toHaveProperty("reviewRequestsEnabled");
    expect(d).not.toHaveProperty("recallEnabled");
    expect(d).not.toHaveProperty("smartRebookingEnabled");
    expect(d).not.toHaveProperty("outboundRecoveryEnabled");
  });
  it("saves the cell as the transfer number", () => {
    expect(signupDefaults("(415) 555-0123").escalationNumber).toBe("+14155550123");
  });
  it("parses the optional cell", () => {
    expect(parseOwnerCell("")).toBeNull();
    expect(parseOwnerCell("415 555 0123")).toBe("+14155550123");
    expect(parseOwnerCell("abc")).toBe("invalid");
  });
});

describe("checklist live-transfer note", () => {
  const base: SetupFacts = {
    services: 1, openDays: 5, faqs: 1, greeting: "hi", calendarConnected: true, alertContacts: 0,
    ownerEmail: "o@x.com", agentId: "a", aiNumber: null, calls: 0, flags: {},
  } as unknown as SetupFacts;
  const alerts = (f: Partial<SetupFacts>) => buildSetupSteps({ ...base, ...f }).find((s) => s.key === "alerts")!;
  it("says transfer is off without a cell", () => {
    expect(alerts({ transferNumber: null }).doneHint).toMatch(/Live transfer is off/);
    expect(alerts({ transferNumber: "+14155550123" }).doneHint).toBeUndefined();
  });
});

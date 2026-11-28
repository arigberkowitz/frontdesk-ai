import { describe, expect, it } from "vitest";
import {
  followupConsentPromptRule,
  followupConsentWordingFor,
  FOLLOWUP_CONSENT_QUESTION,
  messageConsentPromptRule,
  messageConsentWordingFor,
  parseTextConsentAsks,
} from "./text-consent-asks";

describe("text consent asks", () => {
  it("are off unless the owner turned them on", () => {
    expect(parseTextConsentAsks(null)).toEqual({ followup: false, message: false });
    expect(parseTextConsentAsks({})).toEqual({ followup: false, message: false });
    expect(parseTextConsentAsks({ textConsentAsks: { followup: "yes" } })).toEqual({ followup: false, message: false });
    expect(parseTextConsentAsks({ textConsentAsks: { followup: true, message: true } })).toEqual({ followup: true, message: true });
  });

  it("versions the receipt with the language", () => {
    expect(followupConsentWordingFor(null)).toBe("followup-v1");
    expect(followupConsentWordingFor("es")).toBe("followup-v1-es");
    expect(messageConsentWordingFor("en")).toBe("message-v1");
    expect(messageConsentWordingFor("Klingon!")).toBe("message-v1");
  });

  it("the follow-up question states frequency, rates, STOP and that it's optional", () => {
    expect(FOLLOWUP_CONSENT_QUESTION).toMatch(/couple of texts a month/);
    expect(FOLLOWUP_CONSENT_QUESTION).toMatch(/rates may apply/);
    expect(FOLLOWUP_CONSENT_QUESTION).toMatch(/STOP/);
    expect(FOLLOWUP_CONSENT_QUESTION).toMatch(/optional/);
  });

  it("prompt rules quote the exact question and the tool argument", () => {
    const f = followupConsentPromptRule({ spanish: true });
    expect(f).toContain(FOLLOWUP_CONSENT_QUESTION);
    expect(f).toContain("followup_text_consent");
    expect(f).toContain("Una cosa más");
    expect(followupConsentPromptRule({ spanish: false })).not.toContain("Una cosa más");
    const m = messageConsentPromptRule({ spanish: false, quoteAskOn: true });
    expect(m).toContain("message_text_consent");
    expect(m).toContain("quote-text question");
  });
});

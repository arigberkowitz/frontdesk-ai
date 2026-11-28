import { describe, expect, it } from "vitest";
import { leadAlertPhrase, mentionsTexts, TEXTING_PENDING_NOTE } from "./texting-copy";
import { planList } from "@/config/plans";

describe("texting copy until carriers approve texting", () => {
  it("doesn't promise texts while texting is off", () => {
    expect(leadAlertPhrase(false)).toMatch(/^emails you/);
    expect(leadAlertPhrase(false)).toMatch(/once carriers approve/);
    expect(leadAlertPhrase(true)).toBe("texts or emails you");
    expect(TEXTING_PENDING_NOTE).toMatch(/approved by carriers/);
  });

  it("finds the plan bullets that promise texts", () => {
    expect(mentionsTexts("Confirmation & reminder texts")).toBe(true);
    expect(mentionsTexts("Win-back texts: once a month")).toBe(true);
    expect(mentionsTexts("Website chat")).toBe(false);
    expect(mentionsTexts("Context-aware answers")).toBe(false);
    // Every plan that mentions texting gets the footnote marker.
    const texting = planList().flatMap((p) => p.highlights.filter(mentionsTexts));
    expect(texting.length).toBeGreaterThan(0);
  });
});

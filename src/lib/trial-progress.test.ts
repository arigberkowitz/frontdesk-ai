import { describe, expect, it } from "vitest";
import { daysLeftLabel, trialStart, trialStripSummary, trialSummaryLine, upgradePlan } from "./trial-progress";

const DAY = 86_400_000;

describe("trialStart", () => {
  it("is TRIAL_DAYS before the end", () => {
    const end = new Date("2026-10-20T12:00:00Z");
    expect(trialStart(end, new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2026-10-06T12:00:00.000Z");
  });
  it("never starts before the business existed", () => {
    const created = new Date("2026-10-10T00:00:00Z");
    expect(trialStart(new Date("2026-10-20T00:00:00Z"), created)).toEqual(created);
  });
  it("copes with no createdAt", () => {
    const end = new Date(Date.now() + 5 * DAY);
    expect(trialStart(end, null, 14).getTime()).toBe(end.getTime() - 14 * DAY);
  });
});

describe("trialSummaryLine", () => {
  it("says what it did, with plurals", () => {
    expect(trialSummaryLine({ calls: 14, booked: 6 }, true)).toBe(
      "Your AI has handled 14 calls and booked 6 appointments this trial.",
    );
    expect(trialSummaryLine({ calls: 1, booked: 1 }, true)).toBe(
      "Your AI has handled 1 call and booked 1 appointment this trial.",
    );
    expect(trialSummaryLine({ calls: 3, booked: 0 }, true)).toBe("Your AI has handled 3 calls this trial.");
  });
  it("says zero as zero, with the fix that applies", () => {
    expect(trialSummaryLine({ calls: 0, booked: 0 }, true)).toMatch(/Forward your business line/);
    expect(trialSummaryLine({ calls: 0, booked: 0 }, false)).toMatch(/test call/);
  });
});

describe("trialStripSummary", () => {
  it("is short, and empty when there's nothing to say", () => {
    expect(trialStripSummary({ calls: 14, booked: 6 })).toBe("14 calls handled, 6 booked this trial");
    expect(trialStripSummary({ calls: 2, booked: 0 })).toBe("2 calls handled this trial");
    expect(trialStripSummary({ calls: 0, booked: 0 })).toBeNull();
  });
});

describe("upgradePlan", () => {
  it("opens checkout on the plan they picked at signup", () => {
    expect(upgradePlan("pro").key).toBe("pro");
    expect(upgradePlan("backup").key).toBe("backup");
  });
  it("falls back to Starter for nothing, junk, or a retired plan", () => {
    expect(upgradePlan(null).key).toBe("starter");
    expect(upgradePlan("enterprise").key).toBe("starter");
    expect(upgradePlan("scale").key).toBe("starter");
  });
});

describe("daysLeftLabel", () => {
  it("counts down", () => {
    expect(daysLeftLabel(9)).toBe("9 days left in your free trial");
    expect(daysLeftLabel(1)).toBe("1 day left in your free trial");
    expect(daysLeftLabel(0)).toBe("Last day of your free trial");
  });
});

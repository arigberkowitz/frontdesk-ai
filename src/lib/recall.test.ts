import { describe, it, expect } from "vitest";
import {
  RECALL_LEAD_DAYS,
  RECALL_MAX_OVERDUE_DAYS,
  dueDate,
  isDueForRecall,
  monthsBetween,
  recallBody,
  type RecallCandidate,
} from "./recall";

const NOW = new Date("2026-08-27T17:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function candidate(over: Partial<RecallCandidate> = {}): RecallCandidate {
  return {
    // 6-month cleaning, last seen 180 days ago → due today.
    lastVisitAt: daysAgo(180),
    recallIntervalDays: 180,
    status: "booked",
    customerPhone: "+14155550148",
    hasUpcoming: false,
    lastRecalledAt: null,
    ...over,
  };
}

describe("dueDate", () => {
  it("is the visit plus the interval", () => {
    expect(dueDate(new Date("2026-01-01T00:00:00Z"), 180).toISOString()).toBe(
      "2026-06-30T00:00:00.000Z",
    );
  });
});

describe("isDueForRecall", () => {
  it("fires when they're due", () => {
    expect(isDueForRecall(candidate(), NOW)).toBe(true);
  });

  it("fires a week early, so they book into a week that still has slots", () => {
    expect(isDueForRecall(candidate({ lastVisitAt: daysAgo(180 - RECALL_LEAD_DAYS) }), NOW)).toBe(
      true,
    );
  });

  it("stays quiet before the lead window opens", () => {
    expect(isDueForRecall(candidate({ lastVisitAt: daysAgo(100) }), NOW)).toBe(false);
  });

  it("gives up once they're long gone", () => {
    const tooLate = daysAgo(180 + RECALL_MAX_OVERDUE_DAYS + 5);
    expect(isDueForRecall(candidate({ lastVisitAt: tooLate }), NOW)).toBe(false);
  });

  it("never chases somebody already booked in — the worst thing this can do", () => {
    expect(isDueForRecall(candidate({ hasUpcoming: true }), NOW)).toBe(false);
  });

  it("ignores one-off services", () => {
    expect(isDueForRecall(candidate({ recallIntervalDays: null }), NOW)).toBe(false);
    expect(isDueForRecall(candidate({ recallIntervalDays: 0 }), NOW)).toBe(false);
  });

  it("ignores cancellations and no-shows — they were never seen", () => {
    expect(isDueForRecall(candidate({ status: "cancelled" }), NOW)).toBe(false);
    expect(isDueForRecall(candidate({ status: "no_show" }), NOW)).toBe(false);
  });

  it("respects the 90-day cooldown per person", () => {
    expect(isDueForRecall(candidate({ lastRecalledAt: daysAgo(30) }), NOW)).toBe(false);
    expect(isDueForRecall(candidate({ lastRecalledAt: daysAgo(120) }), NOW)).toBe(true);
  });

  it("skips a customer with no number", () => {
    expect(isDueForRecall(candidate({ customerPhone: null }), NOW)).toBe(false);
  });

  it("ignores a visit dated in the future", () => {
    expect(
      isDueForRecall(candidate({ lastVisitAt: new Date(NOW.getTime() + 86_400_000) }), NOW),
    ).toBe(false);
  });
});

describe("recallBody", () => {
  const base = { businessName: "Bright Smile Dental", customerName: "Jordan", monthsSince: 6 };

  it("says what they had, roughly when, and how to reach back", () => {
    const body = recallBody({ ...base, serviceName: "cleaning", callbackNumber: "+15612641168" });
    expect(body).toContain("Jordan");
    expect(body).toContain("Bright Smile Dental");
    expect(body).toContain("cleaning");
    expect(body).toContain("6 months ago");
    expect(body).toContain("+15612641168");
    expect(body).toContain("Reply STOP to opt out.");
  });

  it("still reads properly with nothing optional filled in", () => {
    const body = recallBody({
      businessName: "Fade Factory",
      customerName: null,
      serviceName: null,
      monthsSince: 1,
      callbackNumber: null,
    });
    expect(body).toContain("your last visit");
    expect(body).toContain("a little while back");
    expect(body).not.toContain("null");
    expect(body).not.toContain("undefined");
  });

  it("caps hostile field lengths", () => {
    const body = recallBody({
      businessName: "B".repeat(200),
      customerName: "A".repeat(200),
      serviceName: "C".repeat(200),
      monthsSince: 6,
    });
    expect(body.length).toBeLessThan(350);
  });
});

describe("monthsBetween", () => {
  it("is about right", () => {
    expect(Math.round(monthsBetween(daysAgo(180), NOW))).toBe(6);
  });
});

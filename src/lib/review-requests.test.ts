import { describe, it, expect } from "vitest";
import {
  REVIEW_DELAY_HOURS,
  REVIEW_MAX_AGE_HOURS,
  reviewRequestBody,
  shouldAskForReview,
  visitHappened,
  type ReviewCandidate,
} from "./review-requests";

const NOW = new Date("2026-08-27T18:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function candidate(over: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    appointmentId: "a1",
    customerName: "Jordan Lee",
    customerPhone: "+14155550148",
    status: "booked",
    startAt: hoursAgo(6),
    endAt: hoursAgo(5),
    askedAt: null,
    lastAskedThisPhoneAt: null,
    ...over,
  };
}

describe("visitHappened", () => {
  it("counts a past booking that wasn't cancelled", () => {
    expect(visitHappened(candidate(), NOW)).toBe(true);
  });

  it("never counts a cancellation or a no-show", () => {
    expect(visitHappened(candidate({ status: "cancelled" }), NOW)).toBe(false);
    expect(visitHappened(candidate({ status: "no_show" }), NOW)).toBe(false);
  });

  it("does not count a visit that hasn't finished", () => {
    expect(visitHappened(candidate({ startAt: hoursAgo(-2), endAt: hoursAgo(-1) }), NOW)).toBe(
      false,
    );
  });

  it("falls back to startAt when there is no end time", () => {
    expect(visitHappened(candidate({ endAt: null, startAt: hoursAgo(1) }), NOW)).toBe(true);
  });
});

describe("shouldAskForReview", () => {
  it("asks after a good visit", () => {
    expect(shouldAskForReview(candidate(), NOW)).toBe(true);
  });

  it("waits — nobody gets a text before they've left", () => {
    expect(shouldAskForReview(candidate({ endAt: hoursAgo(REVIEW_DELAY_HOURS - 1) }), NOW)).toBe(
      false,
    );
  });

  it("gives up on stale visits rather than reading as a mailing list", () => {
    const old = hoursAgo(REVIEW_MAX_AGE_HOURS + 1);
    expect(shouldAskForReview(candidate({ startAt: old, endAt: old }), NOW)).toBe(false);
  });

  it("never asks about the same appointment twice", () => {
    expect(shouldAskForReview(candidate({ askedAt: hoursAgo(1) }), NOW)).toBe(false);
  });

  it("never asks the same person twice inside 90 days, even for a new visit", () => {
    const recently = new Date(NOW.getTime() - 30 * 86_400_000);
    expect(shouldAskForReview(candidate({ lastAskedThisPhoneAt: recently }), NOW)).toBe(false);
  });

  it("asks again once the 90 days are up", () => {
    const longAgo = new Date(NOW.getTime() - 200 * 86_400_000);
    expect(shouldAskForReview(candidate({ lastAskedThisPhoneAt: longAgo }), NOW)).toBe(true);
  });

  it("skips a customer with no number", () => {
    expect(shouldAskForReview(candidate({ customerPhone: null }), NOW)).toBe(false);
    expect(shouldAskForReview(candidate({ customerPhone: "   " }), NOW)).toBe(false);
  });

  it("skips cancellations and no-shows", () => {
    expect(shouldAskForReview(candidate({ status: "cancelled" }), NOW)).toBe(false);
    expect(shouldAskForReview(candidate({ status: "no_show" }), NOW)).toBe(false);
  });
});

describe("reviewRequestBody", () => {
  const base = { businessName: "Bright Smile Dental", reviewUrl: "https://g.page/r/abc/review" };

  it("thanks them, names the business, carries the link and the opt-out", () => {
    const body = reviewRequestBody({ ...base, customerName: "Jordan" });
    expect(body).toContain("Jordan");
    expect(body).toContain("Bright Smile Dental");
    expect(body).toContain("https://g.page/r/abc/review");
    expect(body).toContain("Reply STOP to opt out.");
  });

  it("reads properly with no name", () => {
    const body = reviewRequestBody({ ...base, customerName: null });
    expect(body.startsWith("Hi, thanks")).toBe(true);
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("null");
  });

  it("caps hostile field lengths — these come off phone calls", () => {
    const body = reviewRequestBody({ ...base, customerName: "A".repeat(500) });
    expect(body.length).toBeLessThan(300);
  });
});

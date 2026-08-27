import { describe, it, expect } from "vitest";
import {
  MAX_OFFERS_PER_ENTRY,
  MIN_NOTICE_HOURS,
  chooseOffers,
  describeOpening,
  matchesOpening,
  waitlistOfferBody,
  type Opening,
  type WaitlistCandidate,
} from "./waitlist";

const NOW = new Date("2026-08-27T17:00:00.000Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

function entry(over: Partial<WaitlistCandidate> = {}): WaitlistCandidate {
  return {
    id: "w1",
    customerPhone: "+14155550148",
    serviceId: "svc-cleaning",
    earliestAt: hours(24),
    latestAt: hours(24 * 7),
    status: "waiting",
    notifyCount: 0,
    createdAt: new Date("2026-08-20T00:00:00Z"),
    ...over,
  };
}

const opening: Opening = { startAt: hours(48), endAt: hours(49), serviceId: "svc-cleaning" };

describe("matchesOpening", () => {
  it("matches a slot inside their window", () => {
    expect(matchesOpening(entry(), opening, NOW)).toBe(true);
  });

  it("ignores slots before or after the window they gave", () => {
    expect(matchesOpening(entry({ earliestAt: hours(72) }), opening, NOW)).toBe(false);
    expect(matchesOpening(entry({ latestAt: hours(30) }), opening, NOW)).toBe(false);
  });

  it("won't offer a slot starting too soon to get there", () => {
    const imminent: Opening = { ...opening, startAt: hours(MIN_NOTICE_HOURS - 1) };
    expect(matchesOpening(entry({ earliestAt: NOW }), imminent, NOW)).toBe(false);
  });

  it("won't text somebody about the wrong service", () => {
    expect(matchesOpening(entry({ serviceId: "svc-rootcanal" }), opening, NOW)).toBe(false);
  });

  it("treats an unspecified service as 'anything'", () => {
    expect(matchesOpening(entry({ serviceId: null }), opening, NOW)).toBe(true);
    expect(matchesOpening(entry(), { ...opening, serviceId: null }, NOW)).toBe(true);
  });

  it("stops after the offer cap, so a bad week isn't six texts", () => {
    expect(matchesOpening(entry({ notifyCount: MAX_OFFERS_PER_ENTRY }), opening, NOW)).toBe(false);
  });

  it("skips entries that are no longer waiting", () => {
    for (const status of ["booked", "expired", "cancelled", "notified"]) {
      expect(matchesOpening(entry({ status }), opening, NOW), status).toBe(false);
    }
  });

  it("skips an entry whose whole window is already in the past", () => {
    expect(
      matchesOpening(entry({ earliestAt: hours(-48), latestAt: hours(-1) }), opening, NOW),
    ).toBe(false);
  });

  it("skips an entry with no usable number", () => {
    expect(matchesOpening(entry({ customerPhone: "  " }), opening, NOW)).toBe(false);
  });
});

describe("chooseOffers", () => {
  it("offers oldest-waiting first — the only order you can defend out loud", () => {
    const a = entry({ id: "a", createdAt: new Date("2026-08-01T00:00:00Z") });
    const b = entry({ id: "b", createdAt: new Date("2026-08-10T00:00:00Z") });
    const c = entry({ id: "c", createdAt: new Date("2026-08-25T00:00:00Z") });
    expect(chooseOffers([c, b, a], opening, NOW).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("caps how many people hear about one slot", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      entry({ id: `e${i}`, createdAt: new Date(2026, 0, i + 1) }),
    );
    expect(chooseOffers(many, opening, NOW)).toHaveLength(3);
  });

  it("returns nothing when nobody matches", () => {
    expect(chooseOffers([entry({ serviceId: "other" })], opening, NOW)).toEqual([]);
  });
});

describe("waitlistOfferBody", () => {
  it("names the time and never promises the slot is held", () => {
    const body = waitlistOfferBody({
      businessName: "Bright Smile Dental",
      customerName: "Jordan",
      serviceName: "cleaning",
      when: "Thursday, Aug 29 at 2:00 PM",
      callbackNumber: "+15612641168",
    });
    expect(body).toContain("Jordan");
    expect(body).toContain("Thursday, Aug 29 at 2:00 PM");
    expect(body).toContain("First to reply gets it.");
    expect(body).not.toMatch(/held for you|reserved for you/i);
    expect(body).toContain("Reply STOP to opt out.");
  });

  it("reads fine with everything optional missing", () => {
    const body = waitlistOfferBody({
      businessName: "Fade Factory",
      customerName: null,
      serviceName: null,
      when: "Friday at 10:00 AM",
      callbackNumber: null,
    });
    expect(body).not.toContain("null");
    expect(body).not.toContain("undefined");
  });
});

describe("describeOpening", () => {
  it("renders in the business's timezone, not UTC", () => {
    const s = describeOpening(new Date("2026-08-27T21:00:00Z"), "America/New_York");
    expect(s).toContain("5:00");
    expect(s).toContain("Thursday");
  });

  it("falls back rather than throwing on a bad timezone", () => {
    expect(describeOpening(new Date("2026-08-27T21:00:00Z"), "Not/AZone")).toContain("2026");
  });
});

import { describe, expect, it } from "vitest";
import {
  hasWeeklyActivity,
  isoWeekKey,
  weeklySummaryEmail,
  weeklySummarySubject,
  type WeeklySummaryStats,
} from "./weekly-summary-email";

const stats = (over: Partial<WeeklySummaryStats> = {}): WeeklySummaryStats => ({
  calls: 42,
  bookings: 6,
  afterHours: 9,
  leads: 5,
  estRevenueCents: 90_000,
  upcomingRevenueCents: 45_000,
  bookingsMade: 11,
  cancellations: 2,
  missedRecovered: 3,
  textsReceived: 7,
  ...over,
});

describe("isoWeekKey", () => {
  it.each([
    ["2026-09-28T15:00:00Z", "2026-W40"], // the Monday cron
    ["2026-10-04T23:59:59Z", "2026-W40"], // same week, Sunday night
    ["2027-01-01T12:00:00Z", "2026-W53"], // year boundary: belongs to last year's week
    ["2024-12-30T12:00:00Z", "2025-W01"], // …and the other way
    ["2021-01-03T12:00:00Z", "2020-W53"],
  ])("%s → %s", (iso, key) => {
    expect(isoWeekKey(new Date(iso))).toBe(key);
  });
});

describe("weeklySummaryEmail", () => {
  const render = (s = stats(), name = "Bright Smiles") =>
    weeklySummaryEmail({ businessName: name, stats: s, baseUrl: "https://app.test/" });

  it("shows every number the summary promises", () => {
    const { html, text } = render();
    for (const label of [
      "Calls answered",
      "Appointments booked",
      "Cancellations",
      "Missed calls won back",
      "New leads",
      "Texts from customers",
    ]) {
      expect(html).toContain(label);
      expect(text).toContain(label);
    }
    expect(text).toContain("Calls answered: 42");
    expect(text).toContain("Appointments booked: 11");
    expect(text).toContain("Cancellations: 2");
    expect(text).toContain("Missed calls won back: 3");
    expect(text).toContain("New leads: 5");
    expect(text).toContain("Texts from customers: 7");
  });

  it("keeps earned and upcoming revenue separate", () => {
    const { text } = render();
    expect(text).toContain("worth $900");
    expect(text).toContain("$450 still to come");
  });

  it("links to the opt-out setting and never double-slashes the base url", () => {
    const { html, text } = render();
    expect(html).toContain("https://app.test/portal/settings#weekly-summary");
    expect(text).toContain("https://app.test/portal/settings#weekly-summary");
    expect(html).not.toContain("app.test//");
  });

  it("escapes the business name", () => {
    const { html } = render(stats(), `Tom & Jerry's <Clinic>`);
    expect(html).toContain("Tom &amp; Jerry's &lt;Clinic&gt;");
    expect(html).not.toContain("<Clinic>");
  });

  it("subject pluralizes and mentions texts only when there were some", () => {
    expect(weeklySummarySubject(stats())).toBe("Your week: 42 calls answered, 11 bookings, 7 texts");
    expect(weeklySummarySubject(stats({ calls: 1, bookingsMade: 1, textsReceived: 0 }))).toBe(
      "Your week: 1 call answered, 1 booking",
    );
  });

  it("renders the call-health block when there is one", () => {
    const { html } = weeklySummaryEmail({
      businessName: "B",
      stats: stats(),
      baseUrl: "https://app.test",
      health: {
        total: 10,
        strandedAskingForHuman: 2,
        repeatedQuestion: 0,
        earlyHangup: 0,
        noContactCaptured: 0,
        possibleEmergency: 0,
      } as never,
    });
    expect(html).toContain("2 callers asked for a person");
  });
});

describe("hasWeeklyActivity", () => {
  const zero = stats({
    calls: 0,
    bookings: 0,
    afterHours: 0,
    leads: 0,
    estRevenueCents: 0,
    upcomingRevenueCents: 0,
    bookingsMade: 0,
    cancellations: 0,
    missedRecovered: 0,
    textsReceived: 0,
  });
  it("is false for a week with nothing in it", () => expect(hasWeeklyActivity(zero)).toBe(false));
  it("counts texts alone as activity", () =>
    expect(hasWeeklyActivity({ ...zero, textsReceived: 1 })).toBe(true));
  it("counts a cancellation alone as activity", () =>
    expect(hasWeeklyActivity({ ...zero, cancellations: 1 })).toBe(true));
});

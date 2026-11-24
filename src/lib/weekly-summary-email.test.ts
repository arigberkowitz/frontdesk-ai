import { describe, expect, it } from "vitest";
import {
  hasWeeklyActivity,
  isoWeekKey,
  weeklySummaryEmail,
  weeklyGapItems,
  weeklySummarySubject,
  type WeeklySummaryStats,
} from "./weekly-summary-email";
import type { GapGroup, GapSummary } from "./knowledge-gaps";

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
    expect(html).toContain("https://app.test/portal/settings/alerts#weekly-summary");
    expect(text).toContain("https://app.test/portal/settings/alerts#weekly-summary");
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

describe("weeklySummaryEmail — while you were closed", () => {
  const render = (over: Partial<WeeklySummaryStats>) =>
    weeklySummaryEmail({ businessName: "Joe's Plumbing", stats: stats(over), baseUrl: "https://app.test" });

  it("leads with the after-hours numbers, above everything else", () => {
    const { html, text } = render({
      afterHoursWeek: { answered: 7, booked: 3, messages: 2, prior: { answered: 4, booked: 1 } },
    });
    const line = "While you were closed this week, your AI answered 7 calls and booked 3 of them. It took a message on 2 more.";
    expect(html).toContain(line);
    expect(html.indexOf(line)).toBeLessThan(html.indexOf("Calls answered"));
    expect(html).toContain("The week before: 4 after-hours calls, 1 booked.");
    expect(text.split("\n")[2]).toBe(line);
    expect(text).toContain("The week before: 4 after-hours calls, 1 booked.");
    // One after-hours number per email, not two that disagree.
    expect(html).not.toContain("After-hours saves");
    expect(text).not.toContain("After-hours saves");
  });

  it("a zero week gets one honest line and no comparison padding", () => {
    const { html, text } = render({ afterHoursWeek: { answered: 0, booked: 0, messages: 0, prior: { answered: 3, booked: 1 } } });
    expect(html).toContain("No calls came in while you were closed this week.");
    expect(text).toContain("No calls came in while you were closed this week.");
    expect(html).not.toContain("The week before");
    expect(text).not.toContain("The week before");
  });

  it("without saved hours, leaves the section out and keeps the old row", () => {
    for (const afterHoursWeek of [null, undefined]) {
      const { html, text } = render({ afterHoursWeek });
      expect(html).not.toContain("while you were closed");
      expect(html).not.toContain("While you were closed");
      expect(text).toContain("After-hours saves: 9");
    }
  });

  it("keeps the opt-out link", () => {
    const { html } = render({ afterHoursWeek: { answered: 2, booked: 1, messages: 0, prior: { answered: 0, booked: 0 } } });
    expect(html).toContain("https://app.test/portal/settings/alerts#weekly-summary");
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

describe("weekly email: questions your AI couldn't answer", () => {
  const g = (question: string, calls: number, over: Partial<GapGroup> = {}): GapGroup => ({
    question,
    calls,
    callIds: Array.from({ length: calls }, (_, i) => `${question}-${i}`),
    suggestionId: null,
    answered: false,
    ...over,
  });
  const summary = (top: GapGroup[], withGap = top.length): GapSummary => ({
    checked: 20,
    withGap,
    percent: Math.round((withGap / 20) * 100),
    top,
  });
  const render = (gaps: GapSummary | null | undefined) =>
    weeklySummaryEmail({ businessName: "Bright Smiles", stats: stats(), baseUrl: "https://app.test/", gaps });

  it("lists the top 3 unanswered questions, most asked first, with a link to add the answer", () => {
    const { html, text } = render(
      summary([
        g("Do you offer financing?", 3),
        g("Is there parking?", 2, { suggestionId: "sug-1" }),
        g("Do you take Visa & Amex?", 2),
        g("Are you open on holidays?", 1),
      ]),
    );
    expect(html).toContain("Questions your AI couldn't answer this week");
    expect(html).toContain("&quot;Do you offer financing?&quot; came up on 3 calls.");
    expect(html).toContain('href="https://app.test/portal/knowledge?add=Do%20you%20offer%20financing%3F"');
    expect(html).toContain('href="https://app.test/portal#suggestion-sug-1"');
    expect(html).toContain("Review the drafted answer &rarr;");
    expect(html).toContain("Add an answer &rarr;");
    expect(html).not.toContain("holidays");
    expect(text).toContain(
      `- "Do you offer financing?" came up on 3 calls. Add an answer: https://app.test/portal/knowledge?add=Do%20you%20offer%20financing%3F`,
    );
    expect(text).toContain(`- "Is there parking?" came up on 2 calls. Review the drafted answer: https://app.test/portal#suggestion-sug-1`);
    expect(text).not.toContain("holidays");
  });

  it("escapes the question text in the HTML", () => {
    const { html } = render(summary([g("<b>Do you price-match?</b>", 1)]));
    expect(html).toContain("&lt;b&gt;Do you price-match?&lt;/b&gt;");
    expect(html).toContain("came up on 1 call.");
  });

  it("skips questions already answered in the knowledge base", () => {
    const items = weeklyGapItems(summary([g("Is there parking?", 4, { answered: true }), g("Do you offer financing?", 1)]));
    expect(items.map((i) => i.question)).toEqual(["Do you offer financing?"]);
  });

  it.each([
    ["no gap data (gated out or table not migrated)", null],
    ["no gaps argument at all", undefined],
    ["zero gaps this week", summary([], 0)],
    ["nothing checked this week", { checked: 0, withGap: 0, percent: 0, top: [] }],
    ["every gap already answered", summary([g("Is there parking?", 2, { answered: true })])],
  ] as const)("leaves the section out entirely: %s", (_label, gaps) => {
    const { html, text } = render(gaps as GapSummary | null | undefined);
    expect(html).not.toContain("couldn't answer");
    expect(text).not.toContain("couldn't answer");
    expect(html).not.toContain("Add an answer");
  });
});

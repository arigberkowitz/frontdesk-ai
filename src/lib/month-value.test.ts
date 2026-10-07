import { describe, expect, it } from "vitest";
import { buildValueCard, monthLabel, type MonthValueStats } from "./month-value";

const now = new Date("2026-10-07T16:00:00Z");
const base = { now, timeZone: "America/New_York", missedCallTextsEnabled: true, aiTextRepliesEnabled: true };
const zero: MonthValueStats = {
  revenue: { earnedCents: 0, completed: 0, unpriced: 0, upcomingCents: 0, upcoming: 0 },
  calls: { calls: 0, afterHours: 0 },
  recovery: { sent: 0, recovered: 0 },
  texts: { aiTexts: 0, conversations: 0 },
};
const stat = (v: ReturnType<typeof buildValueCard>, key: string) => v.stats.find((s) => s.key === key)!;

describe("buildValueCard", () => {
  it("headline is earned revenue only, with upcoming money kept separate", () => {
    const v = buildValueCard(
      { ...zero, revenue: { earnedCents: 96000, completed: 4, unpriced: 0, upcomingCents: 45000, upcoming: 2 } },
      base,
    );
    expect(v.amount).toBe("$960");
    expect(v.headline).toBe("Frontdesk booked you $960 this month");
    expect(v.notes.map((n) => n.text)).toEqual([
      "From 4 appointments that happened since October 1, each at its service's price.",
      "Plus $450 booked for later in October (2 appointments) — it counts once it happens.",
    ]);
  });

  it("an honest zero state when nothing has happened", () => {
    const v = buildValueCard(zero, base);
    expect(v.amount).toBe("$0");
    expect(v.headline).toBe("Nothing earned yet in October");
    expect(v.lead).toBe("Earned so far in October");
    expect(v.trail).toBe("");
    expect(v.quiet).toBe(true);
    expect(stat(v, "afterHours")).toMatchObject({ value: "0", caption: "No calls yet this month" });
    expect(stat(v, "recovered").value).toBe("0");
    expect(stat(v, "aiTexts").value).toBe("0");
  });

  it("appointments without a price add $0 and say so (no guessing)", () => {
    const v = buildValueCard(
      { ...zero, revenue: { earnedCents: 0, completed: 2, unpriced: 2, upcomingCents: 0, upcoming: 0 } },
      base,
    );
    expect(v.amount).toBe("$0");
    expect(v.notes).toEqual([
      { text: "2 appointments have no price on the service, so they add $0.", href: "/portal/services", linkText: "Add prices" },
    ]);
    expect(v.quiet).toBe(false);
  });

  it("a load failure shows a dash, never a made-up zero", () => {
    const v = buildValueCard({ revenue: null, calls: null, recovery: null, texts: null }, base);
    expect(v.amount).toBeNull();
    expect(v.headline).toMatch(/couldn't load/);
    for (const s of v.stats) expect(s.value).toBe("—");
    expect(v.quiet).toBe(false);
  });

  it("a feature that's off says Off and links to turn it on", () => {
    const v = buildValueCard(zero, { ...base, missedCallTextsEnabled: false, aiTextRepliesEnabled: false });
    expect(stat(v, "recovered")).toMatchObject({ value: "Off", off: true, href: "/portal/settings/follow-ups" });
    expect(stat(v, "aiTexts")).toMatchObject({ value: "Off", off: true });
  });

  it("switched off later still shows what it did this month", () => {
    const v = buildValueCard(
      { ...zero, recovery: { sent: 3, recovered: 1 }, texts: { aiTexts: 5, conversations: 2 } },
      { ...base, missedCallTextsEnabled: false, aiTextRepliesEnabled: false },
    );
    expect(stat(v, "recovered")).toMatchObject({
      value: "1",
      caption: "Of 3 callers we texted after a missed or dropped call, 1 booked, called or texted back",
    });
    expect(stat(v, "aiTexts")).toMatchObject({ value: "5", caption: "AI replies across 2 conversations" });
  });

  it("after-hours copy distinguishes 'no calls' from 'all in open hours'", () => {
    const v = buildValueCard({ ...zero, calls: { calls: 6, afterHours: 0 } }, base);
    expect(stat(v, "afterHours").caption).toMatch(/every call came in during open hours/);
  });

  it("uses the business's word for appointments", () => {
    const v = buildValueCard(
      { ...zero, revenue: { earnedCents: 5000, completed: 1, unpriced: 0, upcomingCents: 0, upcoming: 0 } },
      { ...base, appointmentWord: { one: "visit", many: "visits" } },
    );
    expect(v.notes[0].text).toBe("From 1 visit that happened since October 1, each at its service's price.");
  });
});

describe("monthLabel", () => {
  it("is the business's month, not UTC's", () => {
    // 11:30pm Sep 30 in LA is already Oct 1 in UTC.
    expect(monthLabel(new Date("2026-10-01T06:30:00Z"), "America/Los_Angeles")).toBe("September");
  });
});

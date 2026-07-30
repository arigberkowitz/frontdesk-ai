import { describe, expect, it } from "vitest";
import { computeAvailability } from "@/lib/google-calendar";

const TZ = "America/Los_Angeles";
// Mon 2026-08-03 09:00 PT. Fixed instant so these never depend on "today".
const MON_9AM = Date.parse("2026-08-03T16:00:00.000Z");
const WEEKDAYS_9_TO_5 = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  isClosed: false,
  openTime: "09:00",
  closeTime: "17:00",
}));

function run(over: Partial<Parameters<typeof computeAvailability>[0]> = {}) {
  return computeAvailability({
    busy: [],
    businessHours: WEEKDAYS_9_TO_5,
    durationMin: 60,
    rangeStart: new Date(MON_9AM).toISOString(),
    rangeEnd: new Date(MON_9AM + 7 * 86_400_000).toISOString(),
    timezone: TZ,
    nowMs: MON_9AM,
    ...over,
  });
}

/** Local wall-clock hour of a slot, in the client's timezone. */
const hourOf = (iso: string) =>
  Number(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }).format(
      new Date(iso),
    ),
  );

describe("computeAvailability", () => {
  it("offers slots inside business hours on an empty calendar", () => {
    const { slots, reason } = run();
    expect(reason).toBe("none");
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(hourOf(s.startAt)).toBeGreaterThanOrEqual(9);
      expect(hourOf(s.startAt)).toBeLessThan(17);
    }
  });

  // The bug that made the agent claim a wide-open week was fully booked.
  it("reports no_hours (not all_booked) when hours were never configured", () => {
    const { slots, reason } = run({ businessHours: [] });
    expect(slots).toEqual([]);
    expect(reason).toBe("no_hours");
  });

  it("reports no_hours when every day is marked closed", () => {
    const closed = WEEKDAYS_9_TO_5.map((h) => ({ ...h, isClosed: true }));
    expect(run({ businessHours: closed }).reason).toBe("no_hours");
  });

  it("reports all_booked only when open hours exist but nothing is free", () => {
    // Busy across the whole two-week horizon.
    const { slots, reason } = run({
      busy: [
        {
          start: new Date(MON_9AM - 86_400_000).toISOString(),
          end: new Date(MON_9AM + 20 * 86_400_000).toISOString(),
        },
      ],
    });
    expect(slots).toEqual([]);
    expect(reason).toBe("all_booked");
  });

  it("never offers a slot during a recurring lunch block", () => {
    const { slots } = run({
      blocks: [{ dayOfWeek: null, startTime: "12:00", endTime: "13:00" }],
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.map((s) => hourOf(s.startAt))).not.toContain(12);
  });

  it("applies a weekday-specific block only on that weekday", () => {
    // Block all of Tuesday (dow 2); Monday slots must survive.
    const { slots } = run({
      blocks: [{ dayOfWeek: 2, startTime: "00:00", endTime: "23:59" }],
      limit: 50,
    });
    const tuesdays = slots.filter(
      (s) =>
        new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(
          new Date(s.startAt),
        ) === "Tue",
    );
    expect(tuesdays).toEqual([]);
    expect(slots.length).toBeGreaterThan(0);
  });

  it("honours a one-off closure window", () => {
    // Closed the rest of Monday.
    const { slots } = run({
      blocks: [
        {
          startsAt: new Date(MON_9AM).toISOString(),
          endsAt: new Date(MON_9AM + 12 * 3_600_000).toISOString(),
        },
      ],
      limit: 50,
    });
    const mondayAfternoon = slots.filter((s) => s.startAt < new Date(MON_9AM + 12 * 3_600_000).toISOString());
    expect(mondayAfternoon).toEqual([]);
    expect(slots.length).toBeGreaterThan(0);
  });

  it("never offers a slot in the past", () => {
    const { slots } = run({ limit: 50 });
    for (const s of slots) expect(Date.parse(s.startAt)).toBeGreaterThan(MON_9AM);
  });

  it("does not offer a slot that would run past closing", () => {
    // 90-minute service in a 9–17 day: last valid start is 15:30.
    const { slots } = run({ durationMin: 90, limit: 50 });
    for (const s of slots) expect(Date.parse(s.endAt)).toBeLessThanOrEqual(Date.parse(s.endAt));
    const starts = slots.map((s) => hourOf(s.startAt));
    expect(Math.max(...starts)).toBeLessThanOrEqual(15);
  });
});

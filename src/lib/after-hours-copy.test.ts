import { describe, expect, it } from "vitest";
import { afterHoursComparison, afterHoursHeadline, afterHoursValueLine, type AfterHoursWeek } from "./after-hours-copy";

const w = (answered: number, booked = 0, messages = 0, prior = { answered: 0, booked: 0 }): AfterHoursWeek => ({
  answered,
  booked,
  messages,
  prior,
});

describe("afterHoursHeadline", () => {
  it.each([
    [w(7, 3, 2), "While you were closed this week, your AI answered 7 calls and booked 3 of them. It took a message on 2 more."],
    [w(7, 3), "While you were closed this week, your AI answered 7 calls and booked 3 of them."],
    [w(1, 1), "While you were closed this week, your AI answered 1 call and booked it."],
    [w(3, 3), "While you were closed this week, your AI answered 3 calls and booked all of them."],
    [w(4, 0, 2), "While you were closed this week, your AI answered 4 calls. It took a message on 2 of them."],
    [w(2, 0, 2), "While you were closed this week, your AI answered 2 calls. It took a message on each one."],
    [w(1, 0, 1), "While you were closed this week, your AI answered 1 call. It took a message."],
    [w(2), "While you were closed this week, your AI answered 2 calls."],
  ])("%j", (input, out) => expect(afterHoursHeadline(input)).toBe(out));

  it("says a zero week plainly, in one line", () => {
    expect(afterHoursHeadline(w(0))).toBe("No calls came in while you were closed this week.");
  });

  it("never mentions money", () => {
    expect(afterHoursHeadline(w(9, 4, 3))).not.toMatch(/\$|worth|revenue/i);
  });
});

describe("afterHoursComparison", () => {
  it("compares with the week before", () => {
    expect(afterHoursComparison(w(7, 3, 0, { answered: 4, booked: 1 }))).toBe(
      "The week before: 4 after-hours calls, 1 booked.",
    );
    expect(afterHoursComparison(w(7, 3, 0, { answered: 1, booked: 0 }))).toBe(
      "The week before: 1 after-hours call, 0 booked.",
    );
  });
  it("handles a first week honestly", () => {
    expect(afterHoursComparison(w(2))).toBe("The week before, none came in after hours.");
  });
  it("is null when both weeks are empty", () => {
    expect(afterHoursComparison(w(0))).toBeNull();
  });
});

describe("afterHoursValueLine", () => {
  const v = (booked: number, priced: number, cents: number, atLeast = false): AfterHoursWeek => ({
    ...w(booked + 2, booked),
    value: { priced, cents, atLeast },
  });

  it.each([
    [v(3, 3, 42000), "Those 3 bookings are worth about $420 at your listed prices."],
    [v(1, 1, 9500), "That booking is worth about $95 at your listed prices."],
    [v(3, 2, 30000), "2 of 3 bookings had a listed price, worth about $300."],
    [v(4, 1, 15000), "1 of 4 bookings had a listed price, worth about $150."],
    [v(2, 2, 25000, true), "Those 2 bookings are worth at least $250 at your listed prices."],
    [v(3, 2, 30000, true), "2 of 3 bookings had a listed price, worth at least $300."],
  ])("%j", (input, out) => expect(afterHoursValueLine(input)).toBe(out));

  it("is null when nothing was booked (zero week)", () => {
    expect(afterHoursValueLine(w(0))).toBeNull();
    expect(afterHoursValueLine({ ...w(0), value: { priced: 0, cents: 0, atLeast: false } })).toBeNull();
    expect(afterHoursValueLine({ ...w(4, 0, 2), value: { priced: 0, cents: 0, atLeast: false } })).toBeNull();
  });

  it("is null when none of the bookings had a listed price", () => {
    expect(afterHoursValueLine(v(3, 0, 0))).toBeNull();
  });

  it("is null when the value wasn't computed (older data)", () => {
    expect(afterHoursValueLine(w(5, 3))).toBeNull();
    expect(afterHoursValueLine({ ...w(5, 3), value: null })).toBeNull();
  });

  it("never prints $0 for a free listed service", () => {
    expect(afterHoursValueLine(v(2, 2, 0))).toBeNull();
  });

  it("never claims more priced bookings than were booked", () => {
    expect(afterHoursValueLine(v(2, 5, 20000))).toBe("Those 2 bookings are worth about $200 at your listed prices.");
  });
});

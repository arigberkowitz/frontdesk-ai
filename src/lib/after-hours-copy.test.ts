import { describe, expect, it } from "vitest";
import { afterHoursComparison, afterHoursHeadline, type AfterHoursWeek } from "./after-hours-copy";

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

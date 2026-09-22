import { describe, expect, it } from "vitest";
import { weekOverWeek } from "./trend";

const days = (prev: number[], cur: number[]) => [...prev, ...cur];
const z7 = [0, 0, 0, 0, 0, 0, 0];

describe("weekOverWeek", () => {
  it("says nothing for a business with no history", () => {
    expect(weekOverWeek(days(z7, z7))).toBeNull();
    expect(weekOverWeek([1, 2, 3])).toBeNull();
  });

  it("never prints a percentage over a week of zeros", () => {
    const t = weekOverWeek(days(z7, [0, 0, 1, 2, 0, 0, 1]));
    expect(t?.pct).toBeNull();
    expect(t?.text).toMatch(/first week/);
    expect(t?.tone).toBe("up");
  });

  it("compares the last seven days with the seven before", () => {
    const t = weekOverWeek(days([1, 1, 1, 1, 1, 0, 0], [1, 1, 1, 1, 1, 1, 1]));
    expect(t).toMatchObject({ current: 7, previous: 5, pct: 40, tone: "up" });
    expect(t?.text).toBe("↑ 40% vs last week");
  });

  it("reports a drop", () => {
    const t = weekOverWeek(days([2, 2, 2, 2, 2, 0, 0], [1, 1, 1, 1, 1, 0, 0]));
    expect(t).toMatchObject({ pct: -50, tone: "down" });
    expect(t?.text).toBe("↓ 50% vs last week");
  });

  it("calls a tie a tie", () => {
    const t = weekOverWeek(days([1, 0, 1, 0, 1, 0, 0], [0, 1, 0, 1, 0, 1, 0]));
    expect(t).toMatchObject({ pct: 0, tone: "flat", text: "Same as last week" });
  });

  it("formats the first-week figure with the caller's formatter", () => {
    const t = weekOverWeek(days(z7, [0, 0, 12500, 0, 0, 0, 0]), (n) => `$${n / 100}`);
    expect(t?.text).toBe("$125 this week — first week with any");
  });
});

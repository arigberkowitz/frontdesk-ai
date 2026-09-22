import { describe, expect, it } from "vitest";
import { blocksForDay, clockLabel, gridWindow, placement, selectionRange, toHHMM, toMinutes } from "./week-grid";

describe("time helpers", () => {
  it("round-trips HH:MM", () => {
    expect(toMinutes("13:30")).toBe(810);
    expect(toHHMM(810)).toBe("13:30");
    expect(toHHMM(9 * 60)).toBe("09:00");
  });
  it("prints friendly clock labels", () => {
    expect(clockLabel(0)).toBe("12 AM");
    expect(clockLabel(780)).toBe("1 PM");
    expect(clockLabel(810)).toBe("1:30 PM");
    expect(clockLabel(12 * 60)).toBe("12 PM");
  });
});

describe("gridWindow", () => {
  it("adds an hour either side of the open hours, on whole hours", () => {
    const w = gridWindow([
      { dayOfWeek: 1, openTime: "09:30", closeTime: "17:00", isClosed: false },
      { dayOfWeek: 2, openTime: "08:00", closeTime: "18:30", isClosed: false },
      { dayOfWeek: 0, openTime: "01:00", closeTime: "23:00", isClosed: true },
    ]);
    expect(w).toEqual({ startMin: 7 * 60, endMin: 20 * 60 });
  });
  it("clamps to 6 AM – 10 PM", () => {
    const w = gridWindow([{ dayOfWeek: 1, openTime: "05:00", closeTime: "23:30", isClosed: false }]);
    expect(w).toEqual({ startMin: 6 * 60, endMin: 22 * 60 });
  });
  it("defaults when there are no hours yet", () => {
    expect(gridWindow([])).toEqual({ startMin: 8 * 60, endMin: 18 * 60 });
  });
});

describe("selectionRange", () => {
  it("snaps to slots whichever way the drag went, never shorter than one slot", () => {
    expect(selectionRange(8 * 60, 2, 4)).toEqual({ startTime: "09:00", endTime: "10:30" });
    expect(selectionRange(8 * 60, 4, 2)).toEqual({ startTime: "09:00", endTime: "10:30" });
    expect(selectionRange(8 * 60, 3, 3)).toEqual({ startTime: "09:30", endTime: "10:00" });
  });
});

describe("placement", () => {
  const w = { startMin: 8 * 60, endMin: 18 * 60 };
  it("maps a range to percentages of the window", () => {
    expect(placement(w, "12:00", "13:00")).toEqual({ topPct: 40, heightPct: 10 });
  });
  it("clips to the window and drops ranges outside it", () => {
    expect(placement(w, "07:00", "09:00")).toEqual({ topPct: 0, heightPct: 10 });
    expect(placement(w, "19:00", "20:00")).toBeNull();
  });
});

describe("blocksForDay", () => {
  it("includes every-day blocks", () => {
    const b = (id: string, dayOfWeek: number | null) => ({ id, label: id, dayOfWeek, startTime: "12:00", endTime: "13:00", providerName: null });
    expect(blocksForDay([b("lunch", null), b("mon", 1), b("tue", 2)], 1).map((x) => x.id)).toEqual(["lunch", "mon"]);
  });
});

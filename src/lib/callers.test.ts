import { describe, expect, it } from "vitest";
import { buildCallerIndex, callerKey, callerName, ordinal, priorCalls } from "./callers";

const d = (s: string) => new Date(s);
const calls = [
  { id: "c3", direction: "inbound", fromNumber: "+14155550100", toNumber: "+15550001111", startAt: d("2026-09-20T10:00Z") },
  { id: "c1", direction: "inbound", fromNumber: "(415) 555-0100", toNumber: "+15550001111", startAt: d("2026-09-01T10:00Z") },
  { id: "c2", direction: "outbound", fromNumber: "+15550001111", toNumber: "4155550100", startAt: d("2026-09-10T10:00Z") },
  { id: "x1", direction: "inbound", fromNumber: "+14155550199", toNumber: "+15550001111", startAt: d("2026-09-11T10:00Z") },
  { id: "n1", direction: "inbound", fromNumber: null, toNumber: "+15550001111", startAt: d("2026-09-12T10:00Z") },
];

describe("callerKey", () => {
  it("treats formatting and country code as the same caller", () => {
    expect(callerKey("(415) 555-0100")).toBe("4155550100");
    expect(callerKey("+1 415 555 0100")).toBe("4155550100");
    expect(callerKey("555")).toBeNull();
    expect(callerKey(null)).toBeNull();
  });
});

describe("buildCallerIndex / priorCalls", () => {
  const index = buildCallerIndex(calls, [
    { phone: "+14155550100", name: "  " },
    { phone: "4155550100", name: "Sam Rivera" },
    { phone: "+14155550100", name: "S. Rivera (older)" },
  ]);

  it("orders a caller's calls oldest first, across inbound and outbound", () => {
    expect(index["4155550100"].callIds).toEqual(["c1", "c2", "c3"]);
  });

  it("counts how many came before each call", () => {
    expect(priorCalls(index, calls[1])).toBe(0); // c1
    expect(priorCalls(index, calls[2])).toBe(1); // c2
    expect(priorCalls(index, calls[0])).toBe(2); // c3
    expect(priorCalls(index, calls[3])).toBe(0); // only call from x1
    expect(priorCalls(index, calls[4])).toBe(0); // unknown number
  });

  it("takes the first non-blank name, most recent first", () => {
    expect(callerName(index, "+1 (415) 555-0100")).toBe("Sam Rivera");
    expect(callerName(index, "+14155550199")).toBeNull();
  });
});

describe("ordinal", () => {
  it("handles the English exceptions", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "111th",
    ]);
  });
});

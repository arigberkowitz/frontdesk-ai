import { describe, expect, it } from "vitest";
import { skipBreakdown } from "./missed-call-skips";

describe("missed-call skip reasons for owners", () => {
  it("lists the reasons largest first in plain words", () => {
    const b = skipBreakdown({ already_booked: 1, no_consent: 4, weird: 2, opted_out: 0 });
    expect(b.map((x) => x.reason)).toEqual(["no_consent", "weird", "already_booked"]);
    expect(b[0].label).toBe("Hadn't agreed to texts from you");
    expect(b[1].label).toBe("Other reasons");
  });
});

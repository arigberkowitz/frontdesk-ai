import { describe, expect, it } from "vitest";
import { winbackTeaser } from "./revenue-teasers";

describe("win-back teaser", () => {
  it("uses the business's real count", () => {
    const t = winbackTeaser({ due: 23, textable: 23, months: 6 });
    expect(t.fromData).toBe(true);
    expect(t.line).toBe("23 past customers haven't been back in 6 months or more.");
    expect(t.detail).toMatch(/each of them/);
  });
  it("says how many Pro could actually text", () => {
    expect(winbackTeaser({ due: 23, textable: 9, months: 12 }).detail).toMatch(/^9 of them said yes to texts/);
    expect(winbackTeaser({ due: 4, textable: 0, months: 6 }).detail).toMatch(/couldn't text them/);
  });
  it("falls back to a plain line with no number when the count is zero", () => {
    const t = winbackTeaser({ due: 0, textable: 0, months: 6 });
    expect(t.fromData).toBe(false);
    expect(t.line).not.toMatch(/\d{2,}/);
    expect(t.detail).toBeNull();
  });
  it("reads right for one person", () => {
    expect(winbackTeaser({ due: 1, textable: 1, months: 1 }).line).toBe("1 past customer hasn't been back in 1 month or more.");
  });
});

import { describe, expect, it } from "vitest";
import { reviewTeaser, winbackTeaser } from "./revenue-teasers";

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

describe("review request teaser", () => {
  it("counts real visits and who could be texted", () => {
    const t = reviewTeaser({ visits: 12, textable: 12, days: 30 });
    expect(t.line).toBe("In the last 30 days, 12 booked visits could have gotten a review request.");
    expect(t.detail).toMatch(/each customer/);
    expect(reviewTeaser({ visits: 12, textable: 5, days: 30 }).detail).toMatch(/^5 of them/);
  });
  it("uses a plain line, no number, with no visits", () => {
    const t = reviewTeaser({ visits: 0, textable: 0, days: 30 });
    expect(t.fromData).toBe(false);
    expect(t.line).not.toMatch(/last \d+ days|could have/);
    expect(t.detail).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { websiteChatTeaser } from "./teaser";

describe("websiteChatTeaser", () => {
  it("uses the real after-hours count when there is one", () => {
    expect(websiteChatTeaser(14)).toBe(
      "Your website is closed when you are. 14 people called after hours in the last 30 days, and Pro adds a chat that answers your website visitors at night too.",
    );
    expect(websiteChatTeaser(1)).toContain("1 person called");
  });
  it("falls back to a line with no number in it", () => {
    for (const n of [null, 0]) {
      const line = websiteChatTeaser(n);
      expect(line).not.toMatch(/\d/);
      expect(line).toContain("Pro adds a chat");
    }
  });
});

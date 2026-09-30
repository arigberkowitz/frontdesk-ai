import { describe, expect, it } from "vitest";
import { APP_NAME, APP_TITLE } from "./app";

describe("homepage title", () => {
  it("fits in a search result (≤ 60 chars) and names the product", () => {
    expect(APP_TITLE.length).toBeLessThanOrEqual(60);
    expect(APP_TITLE.startsWith(APP_NAME)).toBe(true);
    expect(APP_TITLE).toMatch(/AI Voice Receptionist/);
  });
});

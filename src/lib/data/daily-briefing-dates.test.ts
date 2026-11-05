import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// postgres-js (prod driver) throws "The 'string' argument must be of type
// string… Received an instance of Date" when a raw Date is interpolated into a
// sql`` fragment; pglite (tests) accepts it, so a behavioural test can't catch
// it. Guard the source instead: window bounds must go in as ISO strings.
describe("daily briefing query params", () => {
  it("never interpolates the Date window bounds into sql fragments", () => {
    const src = readFileSync(join(__dirname, "daily-briefing.ts"), "utf8");
    const fragments = src.match(/sql(<[^>]*>)?`[^`]*`/g) ?? [];
    for (const f of fragments) {
      expect(f).not.toMatch(/\$\{w\.(yesterdayStart|todayStart|\w+Start|\w+End)\}/);
    }
    expect(src).toContain("toISOString()");
  });
});

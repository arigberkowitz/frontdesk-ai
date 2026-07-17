import { describe, expect, it } from "vitest";
import { mapLimit, outOfBudget } from "./util";

describe("mapLimit", () => {
  it("preserves input order in results", async () => {
    const out = await mapLimit([3, 1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n * 10));
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("handles empty input", async () => {
    expect(await mapLimit([], 4, async (x) => x)).toEqual([]);
  });
});

describe("outOfBudget", () => {
  it("false when plenty of budget remains", () => {
    expect(outOfBudget(Date.now() + 60_000)).toBe(false);
  });
  it("true inside the reserve window", () => {
    expect(outOfBudget(Date.now() + 1_000, 5_000)).toBe(true);
  });
});

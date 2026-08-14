import { describe, expect, it } from "vitest";
import { isPurgeable, retentionCutoff, RETENTION_DAYS } from "@/lib/retention";

const NOW = new Date("2026-08-14T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("isPurgeable", () => {
  it("never touches a living account, however old", () => {
    for (const status of ["live", "trial", "paused", "draft"]) {
      expect(
        isPurgeable({ status, deletedAt: null, updatedAt: daysAgo(4000) }, NOW),
      ).toBe(false);
    }
  });

  it("gives churned businesses the full grace period to come back", () => {
    expect(
      isPurgeable({ status: "churned", deletedAt: null, updatedAt: daysAgo(89) }, NOW),
    ).toBe(false);
    expect(
      isPurgeable({ status: "churned", deletedAt: null, updatedAt: daysAgo(91) }, NOW),
    ).toBe(true);
  });

  it("treats soft-deletion by its own clock, whatever the status says", () => {
    // Soft-deleted while still marked live: the deletion is the signal.
    expect(
      isPurgeable({ status: "live", deletedAt: daysAgo(91), updatedAt: daysAgo(1) }, NOW),
    ).toBe(true);
    expect(
      isPurgeable({ status: "live", deletedAt: daysAgo(30), updatedAt: daysAgo(30) }, NOW),
    ).toBe(false);
  });
});

describe("retentionCutoff", () => {
  it("is exactly the promised window", () => {
    expect(NOW.getTime() - retentionCutoff(NOW).getTime()).toBe(RETENTION_DAYS * DAY);
  });
});

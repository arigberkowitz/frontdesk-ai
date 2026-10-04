import { describe, expect, it } from "vitest";
import { computeMrr, countsTowardMrr, type MrrClient, type MrrSubscription } from "./mrr";

const NOW = new Date("2026-10-04T12:00:00Z");
const JUL1 = new Date("2026-07-01T00:00:00Z");
const FUTURE = new Date("2026-10-30T00:00:00Z");

const c = (id: string, status: string, name = id): MrrClient => ({ id, name, status });
const sub = (clientId: string, status: string | null, cents: number | null, end: Date | null = FUTURE): MrrSubscription => ({
  clientId,
  status,
  monthlyPriceCents: cents,
  currentPeriodEnd: end,
});

describe("countsTowardMrr", () => {
  it("needs a live/trial client AND an active/trialing subscription", () => {
    expect(countsTowardMrr("live", "active")).toBe(true);
    expect(countsTowardMrr("live", "trialing")).toBe(true);
    expect(countsTowardMrr("trial", "trialing")).toBe(true);
    expect(countsTowardMrr("trial", "active")).toBe(true);
    for (const cs of ["paused", "churned", "draft"]) {
      expect(countsTowardMrr(cs, "active"), cs).toBe(false);
      expect(countsTowardMrr(cs, "trialing"), cs).toBe(false);
    }
    for (const ss of ["past_due", "canceled", "paused", "incomplete", null]) {
      expect(countsTowardMrr("live", ss), String(ss)).toBe(false);
    }
  });
});

describe("computeMrr", () => {
  it("reproduces the real portfolio: paused clients' stale subscriptions drop out", () => {
    const clients = [
      c("bright", "paused", "Bright Smile Dental"),
      c("fade", "paused", "Fade Factory"),
      c("lfj", "live", "Lawyers for justice"),
      c("glow", "trial", "Glow Med Spa"),
      c("peak", "live", "Peak Plumbing"),
    ];
    const subs = [
      sub("bright", "active", 29900, JUL1),
      sub("fade", "trialing", 19900, JUL1),
      sub("glow", "trialing", 24900),
      sub("peak", "active", 39900),
    ];
    const r = computeMrr(clients, subs, NOW);
    // Old rule (subscription status only) would have said 29900+19900+24900+39900 = 114600.
    expect(r.mrrCents).toBe(24900 + 39900);
    expect(r.mrrByClient.map((x) => x.name)).toEqual(["Peak Plumbing", "Glow Med Spa"]);

    const byClient = Object.fromEntries(r.warnings.map((w) => [w.clientId, w]));
    expect(Object.keys(byClient).sort()).toEqual(["bright", "fade", "lfj"]);
    expect(byClient.bright.kind).toBe("billing_inactive_client");
    expect(byClient.bright.periodEnded).toBe(true);
    expect(byClient.bright.message).toContain("paused");
    expect(byClient.bright.message).toContain("active");
    expect(byClient.bright.message).toContain("period ended Jul 1, 2026");
    expect(byClient.fade.kind).toBe("billing_inactive_client");
    expect(byClient.fade.subscriptionStatus).toBe("trialing");
    expect(byClient.lfj.kind).toBe("live_without_subscription");
  });

  it("keeps counting trialing subscriptions for live and trial clients (unchanged semantics)", () => {
    const r = computeMrr([c("a", "trial"), c("b", "live")], [sub("a", "trialing", 10000), sub("b", "trialing", 5000)], NOW);
    expect(r.mrrCents).toBe(15000);
    expect(r.warnings).toEqual([]);
  });

  it("excludes churned and draft clients and warns about them", () => {
    const r = computeMrr([c("x", "churned"), c("y", "draft")], [sub("x", "active", 10000), sub("y", "trialing", 10000)], NOW);
    expect(r.mrrCents).toBe(0);
    expect(r.warnings.map((w) => w.kind)).toEqual(["billing_inactive_client", "billing_inactive_client"]);
    expect(r.warnings[0].periodEnded).toBe(false);
    expect(r.warnings[0].message).toContain("renews");
  });

  it("warns when a live/trial client's subscription isn't billing, and doesn't count it", () => {
    const r = computeMrr([c("a", "live"), c("b", "trial")], [sub("a", "past_due", 10000), sub("b", "canceled", 10000)], NOW);
    expect(r.mrrCents).toBe(0);
    expect(r.warnings.map((w) => [w.clientId, w.kind])).toEqual([
      ["a", "subscription_not_billing"],
      ["b", "subscription_not_billing"],
    ]);
  });

  it("is quiet for the normal cases: trial without a card, paused client with a canceled sub", () => {
    const r = computeMrr(
      [c("t", "trial"), c("p", "paused"), c("d", "draft")],
      [sub("p", "canceled", 10000)],
      NOW,
    );
    expect(r.warnings).toEqual([]);
    expect(r.mrrCents).toBe(0);
  });

  it("treats a missing price as zero and never double-counts a duplicate row", () => {
    const r = computeMrr([c("a", "live"), c("b", "live")], [sub("a", "active", null), sub("b", "active", 100), sub("b", "active", 100)], NOW);
    expect(r.mrrCents).toBe(100);
    expect(r.mrrByClient).toHaveLength(1);
  });

  it("ignores subscriptions for clients outside the list", () => {
    const r = computeMrr([c("a", "live")], [sub("a", "active", 100), sub("other-org", "active", 99900)], NOW);
    expect(r.mrrCents).toBe(100);
  });
});

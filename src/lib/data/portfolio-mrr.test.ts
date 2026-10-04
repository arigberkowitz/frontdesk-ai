import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * getPortfolioMetrics' MRR end to end against PGlite with the full schema:
 * subscriptions only count when the CLIENT is live or trial, and the
 * mismatches come back as billing warnings.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { db } = await import("@/db");
const s = await import("@/db/schema");
const { getPortfolioMetrics } = await import("./metrics");
const { COST_ASSUMPTIONS } = await import("@/config/plans");

let orgId: string;
const JUL1 = new Date("2026-07-01T00:00:00Z");
const future = new Date(Date.now() + 20 * 86_400_000);

beforeAll(async () => {
  const [org] = await db.insert(s.organizations).values({ name: "Agency", kind: "agency" }).returning();
  const [other] = await db.insert(s.organizations).values({ name: "Other", kind: "agency" }).returning();
  orgId = org.id;
  const mk = async (name: string, status: "live" | "trial" | "paused" | "churned", o = org.id) =>
    (await db.insert(s.clients).values({ orgId: o, name, status }).returning())[0].id;
  const bright = await mk("Bright Smile Dental", "paused");
  const fade = await mk("Fade Factory", "paused");
  await mk("Lawyers for justice", "live");
  const glow = await mk("Glow Med Spa", "trial");
  const peak = await mk("Peak Plumbing", "live");
  const gone = await mk("Gone Co", "churned");
  const foreign = await mk("Foreign", "live", other.id);
  await db.insert(s.subscriptions).values([
    { clientId: bright, status: "active", monthlyPriceCents: 29900, currentPeriodEnd: JUL1 },
    { clientId: fade, status: "trialing", monthlyPriceCents: 19900, currentPeriodEnd: JUL1 },
    { clientId: glow, status: "trialing", monthlyPriceCents: 24900, currentPeriodEnd: future },
    { clientId: peak, status: "active", monthlyPriceCents: 39900, currentPeriodEnd: future },
    { clientId: gone, status: "canceled", monthlyPriceCents: 9900, currentPeriodEnd: JUL1 },
    { clientId: foreign, status: "active", monthlyPriceCents: 100000, currentPeriodEnd: future },
  ]);
});

describe("getPortfolioMetrics MRR", () => {
  it("counts only live/trial clients and flags the mismatches", async () => {
    const m = await getPortfolioMetrics(orgId);
    expect(m.mrrCents).toBe(24900 + 39900);
    expect(m.mrrByClient).toEqual([
      { name: "Peak Plumbing", cents: 39900 },
      { name: "Glow Med Spa", cents: 24900 },
    ]);
    expect(m.marginCents).toBe(m.mrrCents - m.retellCostMonthCents - m.activeClients * COST_ASSUMPTIONS.overheadPerClientCents);
    expect(m.activeClients).toBe(3);

    const warnings = m.billingWarnings.map((w) => [w.clientName, w.kind]).sort();
    expect(warnings).toEqual([
      ["Bright Smile Dental", "billing_inactive_client"],
      ["Fade Factory", "billing_inactive_client"],
      ["Lawyers for justice", "live_without_subscription"],
    ]);
    expect(m.billingWarnings.find((w) => w.clientName === "Bright Smile Dental")?.periodEnded).toBe(true);
  });
});

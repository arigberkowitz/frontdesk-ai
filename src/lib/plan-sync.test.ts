import { describe, expect, it } from "vitest";
import { planSyncPatch, resolvePlanKey, addSpanish, type PlanSyncClient } from "@/lib/plan-sync";
import { resolveFeatures } from "@/lib/plan-access";
import { buildPromptForClient } from "@/lib/agent-publish";
import type { ClientWithRelations } from "@/lib/data/clients";
import { minutesUsage, periodStart } from "@/lib/minutes";
import { PLANS } from "@/config/plans";

const fresh: PlanSyncClient = {
  status: "trial",
  comped: false,
  answeringMode: "all_calls",
  staffModeEnabled: true,
  languages: "en",
};

/** Apply a patch the way the webhook does, then resolve what the client can use. */
function afterPurchase(plan: "backup" | "starter" | "pro", previous: string | null = null) {
  const patch = planSyncPatch(fresh, plan, "active", previous);
  const client = { ...fresh, ...patch };
  const features = resolveFeatures({ status: client.status, comped: false, subscriptionPlan: plan });
  return { patch, client, features };
}

function fakeClient(overrides: Partial<ClientWithRelations>): ClientWithRelations {
  return {
    id: "c1",
    name: "Mission Plumbing",
    industry: "plumbing",
    timezone: "America/Los_Angeles",
    languages: "en",
    answeringMode: "all_calls",
    staffModeEnabled: true,
    services: [],
    businessHours: [],
    knowledgeItems: [],
    providers: [
      { name: "Dana", isActive: true },
      { name: "Luis", isActive: true },
    ],
    setupFlags: {},
    ...overrides,
  } as unknown as ClientWithRelations;
}

describe("paid Missed-Call Rescue customer, end to end", () => {
  const { patch, client, features } = afterPurchase("backup");

  it("goes live, so the plan gates bind", () => {
    expect(patch.status).toBe("live");
    expect(patch.trialEndsAt).toBeNull();
    expect(client.status).toBe("live");
  });

  it("answers missed calls only", () => {
    expect(client.answeringMode).toBe("missed_only");
    expect(features.has("all_calls")).toBe(false);
  });

  it("has no staff mode, callbacks or nightly tuning", () => {
    expect(client.staffModeEnabled).toBe(false);
    expect(features.has("staff_mode")).toBe(false);
    expect(features.has("outbound_ai_calls")).toBe(false);
    expect(features.has("ai_improvement")).toBe(false);
  });

  it("publishes an agent with no staff names", () => {
    const prompt = buildPromptForClient(
      fakeClient({ staffModeEnabled: true, answeringMode: "missed_only" }),
      { staffAllowed: features.has("staff_mode") },
    );
    expect(prompt).not.toContain("Dana");
    expect(prompt).not.toContain("Luis");
  });

  it("gets English & Spanish — every plan includes it now", () => {
    expect(patch.languages).toBe("en-es");
  });

  it("re-applies missed-only even if the owner flipped it back", () => {
    const again = planSyncPatch({ ...client, status: "live", answeringMode: "all_calls" }, "backup", "active", "backup");
    expect(again.answeringMode).toBe("missed_only");
  });
});

describe("paid Pro customer", () => {
  const { patch, client, features } = afterPurchase("pro");

  it("goes live with everything", () => {
    expect(client.status).toBe("live");
    for (const f of ["all_calls", "outbound_ai_calls", "staff_mode", "ai_improvement"] as const) {
      expect(features.has(f)).toBe(true);
    }
  });

  it("keeps 24/7 answering, staff mode and adds Spanish", () => {
    expect(client.answeringMode).toBe("all_calls");
    expect(patch.staffModeEnabled).toBeUndefined();
    expect(client.languages).toBe("en-es");
  });

  it("publishes staff names", () => {
    const prompt = buildPromptForClient(fakeClient({}), { staffAllowed: features.has("staff_mode") });
    expect(prompt).toContain("Dana");
  });
});

describe("plan changes", () => {
  it("upgrading Rescue → Starter turns 24/7 and Spanish on", () => {
    const p = planSyncPatch(
      { ...fresh, status: "live", answeringMode: "missed_only", staffModeEnabled: false },
      "starter",
      "active",
      "backup",
    );
    expect(p.answeringMode).toBe("all_calls");
    expect(p.languages).toBe("en-es");
    expect(p.status).toBeUndefined();
  });

  it("downgrading Pro → Starter drops staff mode but keeps a chosen missed-only", () => {
    const p = planSyncPatch({ ...fresh, status: "live", answeringMode: "missed_only", languages: "en-es" }, "starter", "active", "pro");
    expect(p.staffModeEnabled).toBe(false);
    expect(p.answeringMode).toBeUndefined();
  });

  it("does nothing for a cancelled or unknown subscription", () => {
    expect(planSyncPatch(fresh, "pro", "canceled", "pro")).toEqual({});
    expect(planSyncPatch(fresh, null, "active", null)).toEqual({});
  });

  it("leaves a comped business's settings alone", () => {
    expect(planSyncPatch({ ...fresh, comped: true }, "backup", "active", null)).toEqual({ status: "live", trialEndsAt: null });
  });
});

describe("resolvePlanKey", () => {
  it("prefers metadata, falls back to the price", () => {
    expect(resolvePlanKey("starter", { unitAmount: 50_000, interval: "month" })).toBe("starter");
    expect(resolvePlanKey(undefined, { unitAmount: 59_900, interval: "month" })).toBe("pro");
    expect(resolvePlanKey(undefined, { unitAmount: 199_000, interval: "year" })).toBe("backup");
    expect(resolvePlanKey(undefined, { unitAmount: 39_900, interval: "month" })).toBe("starter");
    expect(resolvePlanKey("bogus", { unitAmount: 1, interval: "month" })).toBeNull();
  });
  it("still resolves a subscription signed at an earlier price", () => {
    expect(resolvePlanKey(undefined, { unitAmount: 14_900, interval: "month" })).toBe("backup");
    expect(resolvePlanKey(undefined, { unitAmount: 300_000, interval: "year" })).toBe("starter");
    expect(resolvePlanKey(undefined, { unitAmount: 50_000, interval: "month" })).toBe("pro");
    expect(resolvePlanKey(undefined, { unitAmount: 12_345, interval: "month" })).toBeNull();
  });
  it("adds Spanish without dropping other languages", () => {
    expect(addSpanish("en")).toBe("en-es");
    expect(addSpanish("en,fr")).toBe("en,fr,es");
    expect(addSpanish("es")).toBe("es");
  });
});

describe("minutes", () => {
  it("reports usage against the included minutes, never billing", () => {
    expect(minutesUsage(150 * 60, PLANS.backup.includedMinutes).tone).toBe("ok");
    expect(minutesUsage(170 * 60, 200).tone).toBe("near");
    const over = minutesUsage(230 * 60, 200);
    expect(over.tone).toBe("over");
    expect(over.percent).toBe(100);
    expect(over.text).toContain("no overage charge");
    expect(over.text).toContain("Past 220 minutes, we email you once a billing period about a plan that fits");
    expect(minutesUsage(2_600 * 60, 2_500).text).toBe(
      "2,600 of 2,500 minutes used this period · you're past your included minutes. Calls still get answered and there's no overage charge. Past 2,750 minutes, we email you once a billing period about a plan that fits.",
    );
    expect(minutesUsage(999 * 60, null).text).toContain("unlimited");
  });
  it("finds the period start from Stripe's period end", () => {
    const start = periodStart(new Date("2026-11-20T00:00:00Z"), new Date("2026-11-02T00:00:00Z"));
    expect(start.toISOString().slice(0, 10)).toBe("2026-10-20");
  });
});

describe("paying after the trial lapsed", () => {
  it("a business the trial lapse paused goes live again", () => {
    const patch = planSyncPatch({ ...fresh, status: "paused", trialLapsed: true }, "starter", "active", null);
    expect(patch.status).toBe("live");
  });
  it("an owner's own pause stays paused", () => {
    expect(planSyncPatch({ ...fresh, status: "paused" }, "starter", "active", null).status).toBeUndefined();
    expect(planSyncPatch({ ...fresh, status: "paused", trialLapsed: false }, "pro", "active", "starter").status).toBeUndefined();
  });
  it("a lapsed business whose payment didn't go through stays paused", () => {
    for (const s of ["incomplete", "past_due", "canceled"]) {
      expect(planSyncPatch({ ...fresh, status: "paused", trialLapsed: true }, "starter", s, null).status).toBeUndefined();
    }
  });
});

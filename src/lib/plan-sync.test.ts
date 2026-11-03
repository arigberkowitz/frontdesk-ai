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

  it("isn't given Spanish it didn't buy", () => {
    expect(patch.languages).toBeUndefined();
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
    expect(resolvePlanKey(undefined, { unitAmount: 50_000, interval: "month" })).toBe("pro");
    expect(resolvePlanKey(undefined, { unitAmount: 149_000, interval: "year" })).toBe("backup");
    expect(resolvePlanKey("bogus", { unitAmount: 1, interval: "month" })).toBeNull();
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
    expect(minutesUsage(999 * 60, null).text).toContain("unlimited");
  });
  it("finds the period start from Stripe's period end", () => {
    const start = periodStart(new Date("2026-11-20T00:00:00Z"), new Date("2026-11-02T00:00:00Z"));
    expect(start.toISOString().slice(0, 10)).toBe("2026-10-20");
  });
});

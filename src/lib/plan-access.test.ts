import { describe, expect, it } from "vitest";
import { resolveFeatures } from "@/lib/plan-access";

describe("resolveFeatures", () => {
  it("gives the backup plan missed-calls-only, nothing else", () => {
    const f = resolveFeatures({ status: "live", comped: false, subscriptionPlan: "backup" });
    expect(f.has("all_calls")).toBe(false);
    expect(f.has("outbound_ai_calls")).toBe(false);
    expect(f.has("staff_mode")).toBe(false);
    expect(f.has("ai_improvement")).toBe(false);
  });

  it("gives starter the full receptionist but none of the Pro extras", () => {
    const f = resolveFeatures({ status: "live", comped: false, subscriptionPlan: "starter" });
    expect(f.has("all_calls")).toBe(true);
    expect(f.has("outbound_ai_calls")).toBe(false);
    expect(f.has("staff_mode")).toBe(false);
    expect(f.has("ai_improvement")).toBe(false);
  });

  it("gives pro (and legacy scale) everything", () => {
    for (const plan of ["pro", "scale"]) {
      const f = resolveFeatures({ status: "live", comped: false, subscriptionPlan: plan });
      expect(f.has("all_calls")).toBe(true);
      expect(f.has("outbound_ai_calls")).toBe(true);
      expect(f.has("staff_mode")).toBe(true);
      expect(f.has("ai_improvement")).toBe(true);
    }
  });

  // A trial is a demo of the real product, not of the cheap tier.
  it("gives trials everything regardless of intended plan", () => {
    const f = resolveFeatures({ status: "trial", comped: false, subscriptionPlan: null });
    expect(f.has("outbound_ai_calls")).toBe(true);
  });

  // A comp is a favor, not a contract.
  it("gives comped businesses everything, even on a cheap subscription", () => {
    const f = resolveFeatures({ status: "live", comped: true, subscriptionPlan: "backup" });
    expect(f.has("staff_mode")).toBe(true);
  });

  // Hand-set-up businesses from before billing existed must never lose
  // features to a gate that was invented after their handshake deal.
  it("fails open when there is no subscription at all", () => {
    const f = resolveFeatures({ status: "live", comped: false, subscriptionPlan: null });
    expect(f.has("all_calls")).toBe(true);
    expect(f.has("outbound_ai_calls")).toBe(true);
  });

  it("fails open on an unrecognized plan key", () => {
    const f = resolveFeatures({ status: "live", comped: false, subscriptionPlan: "enterprise-2027" });
    expect(f.has("all_calls")).toBe(true);
  });
});

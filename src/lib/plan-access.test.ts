import { describe, expect, it } from "vitest";
import { resolveFeatures } from "@/lib/plan-access";

describe("resolveFeatures", () => {
  it("website chat is Pro only (plus trials and comps)", () => {
    expect(resolveFeatures({ status: "live", comped: false, subscriptionPlan: "backup" }).has("website_chat")).toBe(false);
    expect(resolveFeatures({ status: "live", comped: false, subscriptionPlan: "starter" }).has("website_chat")).toBe(false);
    expect(resolveFeatures({ status: "live", comped: false, subscriptionPlan: "pro" }).has("website_chat")).toBe(true);
    expect(resolveFeatures({ status: "live", comped: false, subscriptionPlan: "scale" }).has("website_chat")).toBe(true);
    expect(resolveFeatures({ status: "trial", comped: false, subscriptionPlan: null }).has("website_chat")).toBe(true);
  });

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

describe("revenue texts are Pro only", () => {
  it("locks win-back on Missed-Call Rescue and Starter, opens it on Pro", () => {
    expect(resolveFeatures({ status: "live", comped: false, subscriptionPlan: "backup" }).has("winback")).toBe(false);
    expect(resolveFeatures({ status: "live", comped: false, subscriptionPlan: "starter" }).has("winback")).toBe(false);
    expect(resolveFeatures({ status: "live", comped: false, subscriptionPlan: "pro" }).has("winback")).toBe(true);
  });
  it("lets trials try it, like every other Pro feature", () => {
    expect(resolveFeatures({ status: "trial", comped: false, subscriptionPlan: null }).has("winback")).toBe(true);
  });
});

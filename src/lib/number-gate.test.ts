import { describe, expect, it } from "vitest";
import { numberGate, type NumberGateFacts } from "./number-gate";

/** The rules for when a business may get its own (paid) phone number: only once it has paid. */

const selfServeTrial: NumberGateFacts = {
  actorRole: "client_admin",
  status: "trial",
  comped: false,
  subscriptionStatus: null,
  firstPaid: false,
};

describe("numberGate", () => {
  it("a fresh self-serve trial is locked — the browser test call is the way to hear it", () => {
    expect(numberGate(selfServeTrial)).toEqual({ unlocked: false, via: null, awaitingFirstCharge: false });
  });

  it("a recorded first payment unlocks it", () => {
    expect(numberGate({ ...selfServeTrial, firstPaid: true }).via).toBe("paid");
    // Even if the subscription has since slipped to past_due: they did pay.
    expect(numberGate({ ...selfServeTrial, firstPaid: true, subscriptionStatus: "past_due" }).unlocked).toBe(true);
  });

  it("an active subscription unlocks it even when the invoice event that records the payment never arrived", () => {
    expect(numberGate({ ...selfServeTrial, subscriptionStatus: "active", firstPaid: false })).toMatchObject({
      unlocked: true,
      via: "paid",
    });
  });

  it("a Stripe trial (card saved, nothing charged) does NOT unlock it, and says a charge is coming", () => {
    expect(numberGate({ ...selfServeTrial, subscriptionStatus: "trialing" })).toEqual({
      unlocked: false,
      via: null,
      awaitingFirstCharge: true,
    });
    // Same once the business went live on that Stripe trial (plan-sync makes it "live").
    expect(numberGate({ ...selfServeTrial, status: "live", subscriptionStatus: "trialing" }).unlocked).toBe(false);
  });

  it("a subscription that didn't go through does not", () => {
    for (const s of ["incomplete", "past_due", "canceled", "paused"]) {
      expect(numberGate({ ...selfServeTrial, subscriptionStatus: s }).unlocked).toBe(false);
      expect(numberGate({ ...selfServeTrial, subscriptionStatus: s }).awaitingFirstCharge).toBe(false);
    }
  });

  it("finishing setup no longer unlocks it, and nor does an operator-approved trial (no such facts exist any more)", () => {
    const facts = { ...selfServeTrial, steps: [], trialApproved: true } as unknown as NumberGateFacts;
    expect(numberGate(facts).unlocked).toBe(false);
  });

  it("operators can always provision — operator-created clients keep working", () => {
    expect(numberGate({ ...selfServeTrial, actorRole: "operator", status: "draft" }).via).toBe("operator");
  });

  it("comped is unlocked; live counts only without a Stripe subscription (an operator's off-Stripe deal)", () => {
    expect(numberGate({ ...selfServeTrial, comped: true }).via).toBe("comped");
    expect(numberGate({ ...selfServeTrial, status: "live" }).via).toBe("live");
    expect(numberGate({ ...selfServeTrial, status: "live", subscriptionStatus: "canceled" }).unlocked).toBe(false);
  });

  it("staff and the system follow the business's state, not their own", () => {
    expect(numberGate({ ...selfServeTrial, actorRole: "client_viewer" }).unlocked).toBe(false);
    expect(numberGate({ ...selfServeTrial, actorRole: "system" }).unlocked).toBe(false);
    expect(numberGate({ ...selfServeTrial, actorRole: "system", subscriptionStatus: "active" }).unlocked).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { numberGate, type NumberGateFacts } from "./number-gate";

/** The rules for when a business may get its own (paid) phone number. */

const step = (key: string, done: boolean) => ({ key, label: key, href: `/portal/${key}`, done });
const OPEN_SETUP = [
  step("services", true),
  step("hours", true),
  step("faqs", false),
  step("greeting", true),
  step("calendar", false),
  step("alerts", true),
  step("live", false),
  step("testcall", false),
  step("forwarding", false),
];
const FINISHED_SETUP = OPEN_SETUP.map((s) => ({ ...s, done: s.key === "live" || s.key === "forwarding" ? false : true }));

const selfServeTrial: NumberGateFacts = {
  actorRole: "client_admin",
  status: "trial",
  comped: false,
  subscriptionStatus: null,
  trialApproved: false,
  steps: OPEN_SETUP,
};

describe("numberGate", () => {
  it("a fresh self-serve trial is reserved, and lists the setup steps still open", () => {
    const g = numberGate(selfServeTrial);
    expect(g.unlocked).toBe(false);
    expect(g.via).toBeNull();
    expect(g.setupStepsLeft.map((s) => s.key)).toEqual(["faqs", "calendar", "testcall"]);
  });

  it("never asks for the steps that need the number itself", () => {
    const g = numberGate(selfServeTrial);
    expect(g.setupStepsLeft.map((s) => s.key)).not.toContain("live");
    expect(g.setupStepsLeft.map((s) => s.key)).not.toContain("forwarding");
  });

  it("a card on file (active or trialing subscription) unlocks it", () => {
    expect(numberGate({ ...selfServeTrial, subscriptionStatus: "active" }).via).toBe("card");
    expect(numberGate({ ...selfServeTrial, subscriptionStatus: "trialing" }).via).toBe("card");
  });

  it("a subscription that didn't go through does not", () => {
    for (const s of ["incomplete", "past_due", "canceled", "paused"]) {
      expect(numberGate({ ...selfServeTrial, subscriptionStatus: s }).unlocked).toBe(false);
    }
  });

  it("finishing guided setup (test call included) unlocks it", () => {
    expect(numberGate({ ...selfServeTrial, steps: FINISHED_SETUP })).toMatchObject({
      unlocked: true,
      via: "setup",
      setupStepsLeft: [],
    });
  });

  it("setup without the test call is not finished", () => {
    const noCall = FINISHED_SETUP.map((s) => (s.key === "testcall" ? { ...s, done: false } : s));
    expect(numberGate({ ...selfServeTrial, steps: noCall }).unlocked).toBe(false);
  });

  it("an empty checklist (data didn't load) never counts as finished", () => {
    expect(numberGate({ ...selfServeTrial, steps: [] }).unlocked).toBe(false);
  });

  it("operators can always provision — operator-created clients keep working", () => {
    expect(numberGate({ ...selfServeTrial, actorRole: "operator", status: "draft" }).via).toBe("operator");
  });

  it("comped, live and operator-approved trials are unlocked", () => {
    expect(numberGate({ ...selfServeTrial, comped: true }).via).toBe("comped");
    expect(numberGate({ ...selfServeTrial, status: "live" }).via).toBe("live");
    expect(numberGate({ ...selfServeTrial, trialApproved: true }).via).toBe("approved_trial");
  });

  it("staff and the system follow the business's state, not their own", () => {
    expect(numberGate({ ...selfServeTrial, actorRole: "client_viewer" }).unlocked).toBe(false);
    expect(numberGate({ ...selfServeTrial, actorRole: "system" }).unlocked).toBe(false);
    expect(numberGate({ ...selfServeTrial, actorRole: "system", subscriptionStatus: "active" }).unlocked).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { matchService, serviceClarification } from "./service-match";

/**
 * Booking the wrong service is a silent failure: the caller is told yes, and
 * the business finds a 15-minute follow-up where a two-hour consultation
 * should be. These are the readings the old first-substring-wins rule got wrong.
 */

const MENU = [
  { id: "consult", name: "Consultation", isActive: true },
  { id: "followup", name: "Consultation — Follow-up", isActive: true },
  { id: "retired", name: "Notary Service", isActive: false },
];

describe("matchService", () => {
  it("prefers an exact name over one that merely contains it", () => {
    // "Consultation" is a prefix of "Consultation — Follow-up", so a substring
    // scan matched whichever row the database returned first.
    const m = matchService("consultation", MENU);
    expect(m.kind).toBe("exact");
    expect(m.kind === "exact" && m.service.id).toBe("consult");
  });

  it("matches the longer name when that's what was said", () => {
    const m = matchService("consultation follow-up", MENU);
    expect(m.kind === "exact" && m.service.id).toBe("followup");
  });

  it("never books a service the owner switched off", () => {
    const m = matchService("notary", MENU);
    expect(m.kind).toBe("none");
    expect(m.kind === "none" && m.options.map((s) => s.id)).not.toContain("retired");
  });

  it("does not offer retired services as alternatives either", () => {
    const m = matchService("teeth whitening", MENU);
    expect(serviceClarification(m)).not.toContain("Notary");
  });

  it("asks instead of guessing when two readings are equally good", () => {
    const menu = [
      { id: "a", name: "Massage 60", isActive: true },
      { id: "b", name: "Massage 90", isActive: true },
    ];
    const m = matchService("massage", menu);
    expect(m.kind).toBe("ambiguous");
    expect(serviceClarification(m)).toContain("Massage 60");
    expect(serviceClarification(m)).toContain("Massage 90");
  });

  it("handles the punctuation and filler a transcript actually produces", () => {
    expect(matchService("CONSULTATION.", MENU).kind).toBe("exact");
    expect(matchService("  consultation  ", MENU).kind).toBe("exact");
  });

  it("finds the service inside a whole spoken sentence", () => {
    const menu = [{ id: "clean", name: "Teeth Cleaning", isActive: true }];
    const m = matchService("I'd like a teeth cleaning please", menu);
    expect(m.kind === "exact" && m.service.id).toBe("clean");
  });

  it("asks when nothing was said at all", () => {
    const m = matchService("", MENU);
    expect(m.kind).toBe("none");
    expect(serviceClarification(m)).toContain("Consultation");
  });

  it("says something sane when the menu is empty", () => {
    const m = matchService("anything", []);
    expect(m.kind).toBe("none");
    expect(serviceClarification(m)).toBe(
      "I'm not sure which service that is — could you say it again?",
    );
  });

  it("treats a missing isActive as active — legacy rows predate the flag", () => {
    const m = matchService("intake", [{ id: "x", name: "Intake" }]);
    expect(m.kind === "exact" && m.service.id).toBe("x");
  });
});

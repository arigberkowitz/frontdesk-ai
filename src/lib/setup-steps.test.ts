import { describe, expect, it } from "vitest";
import { buildSetupSteps, checklistMode, type SetupFacts } from "./setup-steps";

const fresh: SetupFacts = {
  services: 0,
  openDays: 0,
  faqs: 0,
  greeting: null,
  calendarConnected: false,
  alertContacts: 0,
  ownerEmail: null,
  agentId: null,
  aiNumber: null,
  calls: 0,
  flags: {},
};

const done: SetupFacts = {
  services: 3,
  openDays: 5,
  faqs: 4,
  greeting: "Thanks for calling Bright Smiles!",
  calendarConnected: true,
  alertContacts: 1,
  ownerEmail: "o@biz.test",
  agentId: "agent_1",
  aiNumber: "(415) 555-0100",
  calls: 2,
  flags: { forwardingDone: true },
};

const byKey = (f: SetupFacts) => Object.fromEntries(buildSetupSteps(f).map((s) => [s.key, s]));

describe("buildSetupSteps", () => {
  it("covers hours, services, forwarding, going live (agent + number) and a test call", () => {
    expect(buildSetupSteps(fresh).map((s) => s.key)).toEqual([
      "services",
      "hours",
      "faqs",
      "greeting",
      "calendar",
      "alerts",
      "live",
      "testcall",
      "forwarding",
    ]);
  });

  it("a brand-new business has nothing done", () => {
    expect(buildSetupSteps(fresh).filter((s) => s.done)).toHaveLength(0);
  });

  it("a fully set-up business has everything done", () => {
    expect(buildSetupSteps(done).every((s) => s.done)).toBe(true);
  });

  it("links each step to the existing page where it's done", () => {
    const s = byKey(fresh);
    expect(s.services.href).toBe("/portal/services");
    expect(s.hours.href).toBe("/portal/hours");
    expect(s.forwarding.href).toBe("/portal/settings/phone#forwarding");
    expect(s.testcall.href).toBe("/portal/guidelines#test-call");
    expect(s.calendar.href).toBe("/portal/settings/calendar");
  });

  it("asks for a test call before the business line is forwarded", () => {
    const keys = buildSetupSteps(fresh).map((s) => s.key);
    expect(keys.indexOf("testcall")).toBeLessThan(keys.indexOf("forwarding"));
  });

  it("Missed-Call Rescue gets no-answer forwarding, not the forward-everything *72 code", () => {
    const rescue = byKey({ ...fresh, aiNumber: "(415) 555-0100", answeringMode: "missed_only" }).forwarding;
    expect(rescue.hint).toMatch(/no-answer forwarding/);
    expect(rescue.hint).not.toMatch(/\*72/);
    const full = byKey({ ...fresh, aiNumber: "(415) 555-0100", answeringMode: "all_calls" }).forwarding;
    expect(full.hint).toMatch(/\*72/);
  });

  it("hours only count when at least one day is open", () => {
    expect(byKey({ ...fresh, openDays: 0 }).hours.done).toBe(false);
    expect(byKey({ ...fresh, openDays: 1 }).hours.done).toBe(true);
  });

  it("going live needs the agent AND a phone number", () => {
    expect(byKey({ ...fresh, agentId: "agent_1" }).live.done).toBe(false);
    expect(byKey({ ...fresh, agentId: "agent_1" }).live.hint).toMatch(/hasn't been given a phone number/);
    expect(byKey({ ...fresh, agentId: "agent_1", aiNumber: "(415) 555-0100" }).live.done).toBe(true);
    expect(byKey(done).live.doneHint).toMatch(/picks up changes automatically/);
  });

  it("forwarding shows the real dial code once there's a number, and is confirmed manually", () => {
    const before = byKey(fresh).forwarding;
    expect(before.manual).toBe(false);
    const after = byKey({ ...fresh, aiNumber: "(415) 555-0100" }).forwarding;
    expect(after.manual).toBe(true);
    expect(after.hint).toContain("*72 (415) 555-0100");
    expect(after.done).toBe(false);
    expect(byKey({ ...fresh, flags: { forwardingDone: true } }).forwarding.done).toBe(true);
  });

  it("a skipped calendar is done, but says what skipping means", () => {
    const s = byKey({ ...fresh, flags: { calendarSkipped: true } }).calendar;
    expect(s.done).toBe(true);
    expect(s.doneHint).toMatch(/takes messages instead/);
  });

  it("the test call ticks off when the first real call appears", () => {
    expect(byKey({ ...fresh, calls: 1 }).testcall.done).toBe(true);
  });

  it("alerts count either a roster contact or an owner email", () => {
    expect(byKey({ ...fresh, alertContacts: 1 }).alerts.done).toBe(true);
    expect(byKey({ ...fresh, ownerEmail: " o@biz.test " }).alerts.done).toBe(true);
    expect(byKey({ ...fresh, ownerEmail: "  " }).alerts.done).toBe(false);
  });
});

describe("checklistMode", () => {
  const base = { finishedAt: null, hiddenAt: null, reviewNotes: 0 };

  it("overview: shows for a new business until setup is finished", () => {
    expect(checklistMode({ ...base, variant: "overview" })).toBe("checklist");
    expect(checklistMode({ ...base, variant: "overview", finishedAt: "2026-09-30T00:00:00Z" })).toBe(
      "hidden",
    );
  });

  it("overview: 'Hide for now' removes the unfinished checklist", () => {
    expect(checklistMode({ ...base, variant: "overview", hiddenAt: "2026-09-30T00:00:00Z" })).toBe(
      "hidden",
    );
  });

  it("overview: a finished setup with AI suggestions shows just the suggestions", () => {
    expect(
      checklistMode({ ...base, variant: "overview", finishedAt: new Date(), reviewNotes: 2 }),
    ).toBe("notes");
  });

  it("settings: always shows the full checklist (where hidden/finished ones live on)", () => {
    expect(checklistMode({ ...base, variant: "settings", hiddenAt: "x" })).toBe("checklist");
    expect(checklistMode({ ...base, variant: "settings", finishedAt: new Date() })).toBe("checklist");
  });
});

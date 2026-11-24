import { describe, expect, it } from "vitest";
import {
  morningTextDue,
  morningUnbookedEnabled,
  morningWindow,
  pickUnbookedCallers,
  renderMorningUnbookedText,
  shortWanted,
  type AfterHoursCallRow,
} from "./morning-unbooked";

const at = (iso: string) => new Date(iso);
const call = (id: string, over: Partial<AfterHoursCallRow> = {}): AfterHoursCallRow => ({
  callId: id,
  fromNumber: "+14155550100",
  startAt: at("2026-09-30T04:00:00Z"),
  outcome: "lead",
  summary: null,
  lead: null,
  ...over,
});
const lead = (id: string, over: Partial<NonNullable<AfterHoursCallRow["lead"]>> = {}) => ({
  id,
  name: "Maria Lopez",
  phone: "+14155550100",
  reason: "Water heater quote",
  service: null,
  status: "new",
  ...over,
});
const none = { bookedPhones: new Set<string>(), bookedCallIds: new Set<string>() };

describe("morning window + due", () => {
  it("is opt-in", () => {
    expect(morningUnbookedEnabled({ setupFlags: {} })).toBe(false);
    expect(morningUnbookedEnabled({ setupFlags: { morningUnbookedText: true } })).toBe(true);
    expect(morningUnbookedEnabled({ setupFlags: null })).toBe(false);
  });

  it("sends only 8–11am in the business's own zone", () => {
    const t = at("2026-09-30T15:30:00Z"); // 8:30 PDT, 11:30 EDT
    expect(morningTextDue(t, "America/Los_Angeles")).toBe(true);
    expect(morningTextDue(t, "America/New_York")).toBe(false);
    expect(morningTextDue(at("2026-09-30T14:59:00Z"), "America/Los_Angeles")).toBe(false); // 7:59
    expect(morningTextDue(t, "Not/AZone")).toBe(false);
  });

  it("covers 8am yesterday → 8am today, local, back to back", () => {
    const w = morningWindow(at("2026-09-30T16:00:00Z"), "America/Los_Angeles");
    expect(w.dayKey).toBe("2026-09-30");
    expect(w.start.toISOString()).toBe("2026-09-29T15:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-30T15:00:00.000Z");
    const next = morningWindow(at("2026-10-01T16:00:00Z"), "America/Los_Angeles");
    expect(next.start.toISOString()).toBe(w.end.toISOString());
  });

  it("handles the DST change (window is 25h on fall-back day)", () => {
    const w = morningWindow(at("2026-11-02T17:00:00Z"), "America/Los_Angeles");
    expect(w.end.toISOString()).toBe("2026-11-02T16:00:00.000Z"); // 8am PST
    expect(w.start.toISOString()).toBe("2026-11-01T16:00:00.000Z"); // 8am PST on fall-back Sunday
    const before = morningWindow(at("2026-11-01T17:00:00Z"), "America/Los_Angeles");
    expect(before.start.toISOString()).toBe("2026-10-31T15:00:00.000Z"); // 8am PDT
  });
});

describe("pickUnbookedCallers", () => {
  it("drops booked, spam, handled leads, replied leads, blocked and later-booked callers", () => {
    const rows = [
      call("keep", { lead: lead("L1") }),
      call("booked", { outcome: "booked", fromNumber: "+14155550111" }),
      call("spam", { outcome: "spam", fromNumber: "+14155550112" }),
      call("contacted", { fromNumber: "+14155550113", lead: lead("L2", { phone: "+14155550113", status: "contacted" }) }),
      call("replied", { fromNumber: "+14155550114", lead: lead("L3", { phone: "+14155550114" }) }),
      call("blocked", { fromNumber: "(415) 555-0115" }),
      call("bookedLater", { fromNumber: "+14155550116" }),
      call("apptOnCall", { fromNumber: "+14155550117" }),
    ];
    const out = pickUnbookedCallers(rows, {
      bookedPhones: new Set(["4155550116"]),
      bookedCallIds: new Set(["apptOnCall"]),
      blockedNumbers: ["4155550115"],
      repliedLeadIds: new Set(["L3"]),
    });
    expect(out.map((c) => c.callId)).toEqual(["keep"]);
    expect(out[0]).toMatchObject({ leadId: "L1", name: "Maria Lopez", wanted: "Water heater quote" });
  });

  it("lists each caller once, keeping the lead and the details from any of their calls", () => {
    const rows = [
      call("first", { startAt: at("2026-09-30T03:00:00Z"), lead: lead("L1") }),
      call("second", { startAt: at("2026-09-30T05:00:00Z"), outcome: "missed" }),
    ];
    const out = pickUnbookedCallers(rows, none);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ callId: "second", leadId: "L1", wanted: "Water heater quote", hungUp: false });
  });

  it("falls back to the call summary, and never invents a reason", () => {
    const out = pickUnbookedCallers(
      [
        call("a", { fromNumber: "+14155550120", summary: "Caller asked about weekend hours. Said they'd call back." }),
        call("b", { fromNumber: "+14155550121", outcome: "missed" }),
        call("c", { fromNumber: null, outcome: "other" }),
      ],
      none,
    );
    expect(out.map((c) => c.wanted)).toEqual(["Caller asked about weekend hours", null, null]);
    expect(out[1].hungUp).toBe(true);
  });
});

describe("renderMorningUnbookedText", () => {
  const base = "https://app.test/";
  it("returns null when nobody needs chasing", () => {
    expect(renderMorningUnbookedText({ businessName: "Ohana Plumbing", callers: [], baseUrl: base, canAiCall: true })).toBeNull();
  });

  it("names, numbers, what they wanted and a link each; AI-call hint only on plans that have it", () => {
    const callers = pickUnbookedCallers(
      [
        call("c1", { lead: lead("L1") }),
        call("c2", { fromNumber: "+16505550199", outcome: "missed" }),
      ],
      none,
    );
    const pro = renderMorningUnbookedText({ businessName: "Ohana Plumbing", callers, baseUrl: base, canAiCall: true })!;
    expect(pro).toContain("Ohana Plumbing: 2 after-hours callers last night didn't book.");
    expect(pro).toContain("1. Maria Lopez (415) 555-0100 — Water heater quote\nhttps://app.test/portal/leads#lead-L1");
    expect(pro).toContain("2. (650) 555-0199 — hung up before leaving details\nhttps://app.test/portal/calls/c2");
    expect(pro).toContain('tap "AI calls them"');

    const starter = renderMorningUnbookedText({ businessName: "Ohana Plumbing", callers, baseUrl: base, canAiCall: false })!;
    expect(starter).not.toContain("AI calls them");
    expect(starter).toContain("Tap a link for the details");
  });

  it("caps the list and links the rest", () => {
    const callers = pickUnbookedCallers(
      Array.from({ length: 7 }, (_, i) => call(`c${i}`, { fromNumber: `+1415555020${i}` })),
      none,
    );
    const t = renderMorningUnbookedText({ businessName: "B", callers, baseUrl: base, canAiCall: false })!;
    expect(t).toContain("7 after-hours callers");
    expect(t).toContain("+2 more: https://app.test/portal/leads");
    expect(t).not.toContain("6. ");
  });

  it("shortWanted trims to one sentence", () => {
    expect(shortWanted("  Needs a quote.  Also asked price. ")).toBe("Needs a quote");
    expect(shortWanted("x".repeat(100))?.length).toBe(70);
    expect(shortWanted(null)).toBeNull();
  });
});

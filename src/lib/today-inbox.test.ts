import { describe, expect, it } from "vitest";
import {
  buildTodayInbox,
  EMPTY_INBOX_COUNTS,
  portalPreviewHref,
  resolvePortalPreviewNext,
  type InboxCounts,
} from "./today-inbox";

const NOW = new Date("2026-10-04T12:00:00Z");
const D = 86_400_000;
const clients = [
  { id: "lfj", name: "Lawyers for justice" },
  { id: "peak", name: "Peak Plumbing" },
  { id: "glow", name: "Glow Med Spa" },
];
const counts = (over: Partial<InboxCounts>): InboxCounts => ({ ...EMPTY_INBOX_COUNTS, ...over });

describe("buildTodayInbox", () => {
  it("is empty when nothing is waiting", () => {
    expect(buildTodayInbox(clients, EMPTY_INBOX_COUNTS, NOW)).toEqual({ items: [], total: 0 });
  });

  it("links each item to where the operator acts on it", () => {
    const { items } = buildTodayInbox(
      clients,
      counts({
        unreadThreads: [{ clientId: "lfj", count: 1 }],
        newLeads: [{ clientId: "lfj", count: 2 }],
        proposedFixes: [{ clientId: "peak", count: 1 }],
        openGrades: [{ clientId: "lfj", count: 1 }, { clientId: "peak", count: 1 }],
        trialsEnding: [{ clientId: "glow", trialEndsAt: new Date(NOW.getTime() + 4 * D) }],
        failedReminders: [{ clientId: "peak", count: 1 }],
        failedTexts: [{ clientId: "peak", count: 1 }],
        failedRuns: [{ clientId: "lfj", count: 1 }],
      }),
      NOW,
    );
    const byKind = Object.fromEntries(items.map((i) => [i.key, i]));
    // Portal-only actions go through the operator's portal preview.
    expect(byKind["unread_sms:lfj"].href).toBe("/clients/lfj/preview-portal?next=%2Fportal%2Fmessages");
    expect(byKind["unread_sms:lfj"].title).toBe("1 unread text thread");
    expect(byKind["proposed_fixes:peak"].href).toBe("/clients/peak/preview-portal?next=%2Fportal");
    expect(byKind["failed_sends:peak"].href).toContain("/clients/peak/preview-portal");
    // Operator pages otherwise.
    expect(byKind["new_leads:lfj"].href).toBe("/clients/lfj?tab=leads");
    expect(byKind["new_leads:lfj"].title).toBe("2 new leads");
    expect(byKind["open_grades"].href).toBe("/review");
    expect(byKind["trial_ending:glow"].href).toBe("/clients/glow?tab=settings");
    expect(byKind["failed_runs:lfj"].href).toBe("/clients/lfj?tab=agent");
  });

  it("orders customer-facing items first", () => {
    const { items } = buildTodayInbox(
      clients,
      counts({
        failedRuns: [{ clientId: "lfj", count: 1 }],
        openGrades: [{ clientId: "lfj", count: 4 }],
        newLeads: [{ clientId: "peak", count: 1 }, { clientId: "lfj", count: 3 }],
        unreadThreads: [{ clientId: "peak", count: 1 }],
      }),
      NOW,
    );
    expect(items.map((i) => i.key)).toEqual([
      "unread_sms:peak",
      "new_leads:lfj", // more leads first
      "new_leads:peak",
      "open_grades",
      "failed_runs:lfj",
    ]);
  });

  it("rolls all open QA grades into one /review item", () => {
    const { items } = buildTodayInbox(
      clients,
      counts({ openGrades: [{ clientId: "lfj", count: 1 }, { clientId: "peak", count: 3 }] }),
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(4);
    expect(items[0].title).toBe("4 QA grades to review");
    expect(items[0].detail).toBe("Peak Plumbing (3) · Lawyers for justice (1)");
  });

  it("never adds failed reminders and failed texts together (they can be the same send)", () => {
    const { items } = buildTodayInbox(
      clients,
      counts({ failedReminders: [{ clientId: "peak", count: 2 }], failedTexts: [{ clientId: "peak", count: 1 }] }),
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(2);
    expect(items[0].detail).toBe("2 reminders · 1 text failed in the last 7 days");
  });

  it("describes trial deadlines, soonest first, flagging overdue ones", () => {
    const { items } = buildTodayInbox(
      clients,
      counts({
        trialsEnding: [
          { clientId: "glow", trialEndsAt: new Date(NOW.getTime() + 6 * D) },
          { clientId: "peak", trialEndsAt: new Date(NOW.getTime() + 0.5 * D) },
          { clientId: "lfj", trialEndsAt: new Date(NOW.getTime() - 2 * D) },
        ],
      }),
      NOW,
    );
    expect(items.map((i) => [i.clientId, i.detail, i.tone])).toEqual([
      ["lfj", "Trial ended 2 days ago and is still marked trial", "warning"],
      ["peak", "Trial ends tomorrow", "warning"],
      ["glow", "Trial ends in 6 days", "info"],
    ]);
    expect(items[0].title).toBe("Trial overdue");
  });

  it("drops zero counts and clients it doesn't know (deleted / other org)", () => {
    const { items } = buildTodayInbox(
      clients,
      counts({ newLeads: [{ clientId: "lfj", count: 0 }, { clientId: "ghost", count: 5 }] }),
      NOW,
    );
    expect(items).toEqual([]);
  });
});

describe("resolvePortalPreviewNext", () => {
  it("allows portal paths", () => {
    expect(resolvePortalPreviewNext("/portal")).toBe("/portal");
    expect(resolvePortalPreviewNext("/portal/messages")).toBe("/portal/messages");
    expect(resolvePortalPreviewNext("/portal?x=1")).toBe("/portal?x=1");
  });

  it("falls back to /portal for anything else", () => {
    for (const bad of [null, "", "https://evil.test", "//evil.test", "/portal//evil.test", "/dashboard", "/portalx", "/portal/\\evil", "portal"]) {
      expect(resolvePortalPreviewNext(bad), String(bad)).toBe("/portal");
    }
  });

  it("round-trips what portalPreviewHref encodes", () => {
    const href = portalPreviewHref("abc", "/portal/messages");
    const next = new URL(href, "http://x").searchParams.get("next");
    expect(resolvePortalPreviewNext(next)).toBe("/portal/messages");
  });
});

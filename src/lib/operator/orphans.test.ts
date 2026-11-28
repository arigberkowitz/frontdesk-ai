import { describe, expect, it, vi } from "vitest";
import { deleteOrphan, listOrphans, type ActiveHoldings, type OrphanProviders, type OrphanStore } from "./orphans";
import type { Outcome } from "./controls";
import { actor } from "./test-helpers";

const holdings = (over: Partial<ActiveHoldings> = {}): ActiveHoldings => ({
  agentIds: new Set(["agent_live"]),
  llmIds: new Set(["llm_live"]),
  phoneDigits: new Set(["2272382281"]),
  tollfreeSids: new Set(["PN_live"]),
  smsNumbers: new Set(["+18885550000"]),
  stripeSubscriptionIds: new Set(["sub_live"]),
  clientsAwaitingSubscription: new Set(["c_fresh"]),
  ...over,
});

function world(hold = holdings()) {
  const audits: { action: string; detail: Record<string, unknown> }[] = [];
  const store: OrphanStore = {
    activeHoldings: vi.fn(async () => hold),
    audit: vi.fn(async (e) => {
      audits.push(e);
    }),
  };
  const providers = {
    configured: { retell: true as boolean, stripe: true as boolean, twilio: true as boolean },
    listRetellAgents: vi.fn(async () => [
      { id: "agent_live", name: "Live", modifiedAt: 1 },
      { id: "agent_june1", name: "Old June agent", modifiedAt: Date.UTC(2026, 5, 3) },
      { id: "agent_june2", name: null, modifiedAt: null },
    ]),
    listRetellLlms: vi.fn(async () => [
      { id: "llm_live", modifiedAt: null },
      { id: "llm_old", modifiedAt: null },
    ]),
    listRetellNumbers: vi.fn(async () => [
      { phone: "+12272382281", nickname: null },
      { phone: "+14155550199", nickname: "Old test" },
    ]),
    listTwilioAppNumbers: vi.fn(async () => [
      { sid: "PN_live", phone: "+18885550001", name: "FrontDesk SMS · Live" },
      { sid: "PN_old", phone: "+18885550002", name: "FrontDesk SMS · Gone Co" },
    ]),
    listStripeAppSubscriptions: vi.fn(async () => [
      { id: "sub_live", clientId: "c1", customer: "cus_1", summary: "$399/mo · live" },
      { id: "sub_fresh", clientId: "c_fresh", customer: "cus_2", summary: "just checked out" },
      { id: "sub_zombie", clientId: "c_deleted", customer: "cus_3", summary: "$399/mo · zombie@x.com · active" },
    ]),
    deleteRetellAgent: vi.fn(async () => "done" as Outcome),
    deleteRetellLlm: vi.fn(async () => "done" as Outcome),
    releaseRetellNumber: vi.fn(async () => "done" as Outcome),
    releaseTwilioNumber: vi.fn(async () => "done" as Outcome),
    cancelStripeSubscription: vi.fn(async () => "done" as Outcome),
  } satisfies OrphanProviders;
  return { store, providers, audits };
}

describe("listOrphans", () => {
  it("lists only resources with no ACTIVE business, across all four vendors", async () => {
    const w = world();
    const r = await listOrphans(w);
    expect(r.items.map((i) => `${i.kind}:${i.id}`).sort()).toEqual(
      [
        "retell_agent:agent_june1",
        "retell_agent:agent_june2",
        "retell_llm:llm_old",
        "retell_number:+14155550199",
        "stripe_subscription:sub_zombie",
        "twilio_number:PN_old",
      ].sort(),
    );
    expect(r.errors).toEqual([]);
    expect(r.items.find((i) => i.id === "agent_june1")?.detail).toContain("2026-06-03");
  });

  it("is read-only: lists without calling any delete", async () => {
    const w = world();
    await listOrphans(w);
    expect(w.providers.deleteRetellAgent).not.toHaveBeenCalled();
    expect(w.providers.deleteRetellLlm).not.toHaveBeenCalled();
    expect(w.providers.releaseRetellNumber).not.toHaveBeenCalled();
    expect(w.providers.releaseTwilioNumber).not.toHaveBeenCalled();
    expect(w.providers.cancelStripeSubscription).not.toHaveBeenCalled();
  });

  it("one vendor failing doesn't hide the others, and says which failed", async () => {
    const w = world();
    w.providers.listStripeAppSubscriptions.mockRejectedValueOnce(new Error("Stripe is down"));
    const r = await listOrphans(w);
    expect(r.errors).toEqual([{ provider: "Stripe", message: "Stripe is down" }]);
    expect(r.items.some((i) => i.kind === "retell_agent")).toBe(true);
  });

  it("reports unconfigured vendors instead of implying a clean bill of health", async () => {
    const w = world();
    w.providers.configured.stripe = false;
    w.providers.configured.twilio = false;
    const r = await listOrphans(w);
    expect(r.notConfigured).toEqual(["Twilio", "Stripe"]);
    expect(w.providers.listStripeAppSubscriptions).not.toHaveBeenCalled();
  });

  it("matches phone numbers by their last ten digits", async () => {
    const w = world(holdings({ phoneDigits: new Set(["4155550199", "2272382281"]) }));
    const r = await listOrphans(w);
    expect(r.items.some((i) => i.kind === "retell_number")).toBe(false);
  });
});

describe("deleteOrphan", () => {
  it("deletes a genuine orphan, once, and writes an audit entry", async () => {
    const w = world();
    const res = await deleteOrphan(w, actor, { kind: "retell_agent", id: "agent_june1" });
    expect(res).toMatchObject({ ok: true, httpStatus: 200 });
    expect(w.providers.deleteRetellAgent).toHaveBeenCalledWith("agent_june1");
    expect(w.audits[0]).toMatchObject({ action: "operator.delete_orphan", detail: { kind: "retell_agent", id: "agent_june1", by: "ari@example.com" } });
  });

  it.each([
    ["retell_agent", "agent_live", "deleteRetellAgent"],
    ["retell_llm", "llm_live", "deleteRetellLlm"],
    ["retell_number", "+1 (227) 238-2281", "releaseRetellNumber"],
    ["twilio_number", "PN_live", "releaseTwilioNumber"],
    ["stripe_subscription", "sub_live", "cancelStripeSubscription"],
  ] as const)("refuses to delete a live business's %s (409) — a forged request can't remove it", async (kind, id, fn) => {
    const w = world();
    const res = await deleteOrphan(w, actor, { kind, id });
    expect(res.httpStatus).toBe(409);
    expect(w.providers[fn]).not.toHaveBeenCalled();
  });

  it("already gone at the vendor is success", async () => {
    const w = world();
    w.providers.deleteRetellLlm.mockResolvedValueOnce("already_gone");
    const res = await deleteOrphan(w, actor, { kind: "retell_llm", id: "llm_old" });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/already gone/i);
  });

  it("a vendor refusal is reported (502) and audited, never thrown", async () => {
    const w = world();
    w.providers.cancelStripeSubscription.mockRejectedValueOnce(new Error("card_declined? no: locked"));
    const res = await deleteOrphan(w, actor, { kind: "stripe_subscription", id: "sub_zombie" });
    expect(res).toMatchObject({ ok: false, httpStatus: 502 });
    expect(w.audits[0]?.action).toBe("operator.delete_orphan_failed");
  });
});

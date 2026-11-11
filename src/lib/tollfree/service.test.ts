import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientTollfree } from "@/db/schema";
import type { TollfreeClient, TollfreeStore } from "@/lib/data/tollfree";
import { tollfreePurchaseBlocker } from "./eligibility";
import { ensureTollfreeNumber, handleTollfreeEvent, pollTollfree, saveTollfreeDetails, sidsFromEvents, type TollfreeDeps } from "./service";
import type { TollfreeApi } from "./twilio-api";

const SID = "HH" + "a".repeat(32);
const details = {
  legalName: "Bright Smile Plumbing LLC",
  businessType: "PRIVATE_PROFIT",
  ein: "12-3456789",
  website: "brightsmile.example",
  street: "1 Main St",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  contactFirstName: "Pat",
  contactLastName: "Lee",
  contactEmail: "pat@brightsmile.example",
  contactPhone: "(512) 555-0100",
  monthlyVolume: "1,000",
};

function memStore() {
  const rows = new Map<string, ClientTollfree>();
  const smsNumber = new Map<string, string>();
  // Default: a business that finished setup and pays — the one case that buys.
  const facts = new Map<string, Partial<TollfreeClient>>();
  const locks = new Set<string>();
  const store: TollfreeStore = {
    async get(id) { return rows.get(id) ?? null; },
    async save(id, patch) {
      const cur = rows.get(id) ?? ({ id: "r-" + id, clientId: id, status: "needs_number", createdAt: new Date(), updatedAt: new Date() } as ClientTollfree);
      rows.set(id, { ...cur, ...patch } as ClientTollfree);
    },
    async byVerificationSid(sid) { return [...rows.values()].find((r) => r.verificationSid === sid) ?? null; },
    async listSubmitted() { return [...rows.values()].filter((r) => r.status === "submitted"); },
    async client(id) {
      return {
        id,
        name: "Bright Smile",
        smsNumber: smsNumber.get(id) ?? null,
        status: "live",
        setupCompletedAt: new Date("2026-11-01T00:00:00Z"),
        comped: false,
        subscriptionStatus: "active",
        ...facts.get(id),
      };
    },
    async claimPurchase(id) { if (locks.has(id)) return false; locks.add(id); return true; },
    async releasePurchase(id) { locks.delete(id); },
    async useAsSmsNumber(id, n) { if (!smsNumber.has(id)) smsNumber.set(id, n); },
  };
  return { store, rows, smsNumber, facts, locks };
}

let api: { [K in keyof TollfreeApi]: ReturnType<typeof vi.fn> };
let mem: ReturnType<typeof memStore>;
let deps: TollfreeDeps;

beforeEach(() => {
  api = {
    buyNumber: vi.fn(async () => ({ phoneNumber: "+18885551234", sid: "PN1" })),
    submit: vi.fn(async () => ({ sid: SID, status: "PENDING_REVIEW" })),
    resubmit: vi.fn(async () => ({ sid: SID, status: "IN_REVIEW" })),
    fetch: vi.fn(async () => ({ sid: SID, status: "TWILIO_APPROVED" })),
  };
  mem = memStore();
  deps = { enabled: true, api: api as unknown as TollfreeApi, store: mem.store, appUrl: "https://app.test", notificationEmail: "ops@app.test" };
});

describe("toll-free lifecycle (mocked Twilio)", () => {
  it("flag off: nothing is bought or submitted", async () => {
    deps.enabled = false;
    expect(await ensureTollfreeNumber(deps, "c1")).toBeNull();
    expect((await saveTollfreeDetails(deps, "c1", details)).ok).toBe(false);
    expect(await handleTollfreeEvent(deps, SID)).toBeNull();
    expect(api.buyNumber).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("buys a number, then submits details with VERBAL opt-in and the consent page", async () => {
    await ensureTollfreeNumber(deps, "c1");
    expect(mem.rows.get("c1")?.status).toBe("needs_details");
    const r = await saveTollfreeDetails(deps, "c1", details);
    expect(r).toEqual({ ok: true, state: "submitted" });
    const payload = api.submit.mock.calls[0][0];
    expect(payload).toMatchObject({ optInType: "VERBAL", optInImageUrls: ["https://app.test/sms-consent"], tollfreePhoneNumberSid: "PN1", externalReferenceId: "c1" });
    expect(String(payload.messageVolume)).toBe("1,000");
    expect(payload.productionMessageSample.length).toBeGreaterThan(20);
    expect(mem.rows.get("c1")?.verificationSid).toBe(SID);
  });

  it("details saved before the number arrives are submitted once it does", async () => {
    expect(await saveTollfreeDetails(deps, "c1", details)).toEqual({ ok: true, state: "needs_number" });
    expect(api.submit).not.toHaveBeenCalled();
    await ensureTollfreeNumber(deps, "c1");
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(mem.rows.get("c1")?.status).toBe("submitted");
  });

  it("requires an EIN unless sole proprietor", async () => {
    await ensureTollfreeNumber(deps, "c1");
    const bad = await saveTollfreeDetails(deps, "c1", { ...details, ein: "" });
    expect(bad.ok).toBe(false);
    const sole = await saveTollfreeDetails(deps, "c1", { ...details, ein: "", businessType: "SOLE_PROPRIETOR" });
    expect(sole.ok).toBe(true);
    expect(api.submit.mock.calls[0][0].businessRegistrationNumber).toBeUndefined();
  });

  it("approval via webhook makes the number the business's texting number", async () => {
    await ensureTollfreeNumber(deps, "c1");
    await saveTollfreeDetails(deps, "c1", details);
    expect(await handleTollfreeEvent(deps, SID)).toBe("approved");
    expect(mem.smsNumber.get("c1")).toBe("+18885551234");
  });

  it("rejection shows the reason; resubmitting edits the same verification", async () => {
    await ensureTollfreeNumber(deps, "c1");
    await saveTollfreeDetails(deps, "c1", details);
    api.fetch.mockResolvedValueOnce({ sid: SID, status: "TWILIO_REJECTED", rejectionReason: "Website not reachable", editAllowed: true });
    await pollTollfree(deps);
    expect(mem.rows.get("c1")).toMatchObject({ status: "rejected", rejectionReason: expect.stringContaining("Website") });
    expect(mem.smsNumber.has("c1")).toBe(false);
    // EIN left blank = keep the one on file.
    const r = await saveTollfreeDetails(deps, "c1", { ...details, ein: "", website: "https://brightsmile.example/new" });
    expect(r.ok).toBe(true);
    expect(api.resubmit).toHaveBeenCalledWith(SID, expect.objectContaining({ businessRegistrationNumber: "123456789" }));
  });

  it("ignores malformed or unknown verification sids", async () => {
    expect(await handleTollfreeEvent(deps, "nope")).toBeNull();
    expect(await handleTollfreeEvent(deps, "HH" + "b".repeat(32))).toBeNull();
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("pulls sids out of Event Streams CloudEvents", () => {
    expect(sidsFromEvents([{ data: { tollfreeverificationsid: SID } }, { data: {} }])).toEqual([SID]);
    expect(sidsFromEvents("junk")).toEqual([]);
  });
});

describe("toll-free purchase timing: setup finished, not payment", () => {
  it("payment without finished setup buys nothing", async () => {
    mem.facts.set("c1", { setupCompletedAt: null, subscriptionStatus: "active" });
    await ensureTollfreeNumber(deps, "c1"); // Stripe checkout.session.completed
    await ensureTollfreeNumber(deps, "c1"); // customer.subscription.created/updated
    expect(api.buyNumber).not.toHaveBeenCalled();
    expect(mem.rows.has("c1")).toBe(false);
  });

  it("finishing setup on a paying business buys exactly once; repeat events buy nothing", async () => {
    mem.facts.set("c1", { setupCompletedAt: null, subscriptionStatus: "active" });
    await ensureTollfreeNumber(deps, "c1"); // paid
    expect(api.buyNumber).not.toHaveBeenCalled();
    mem.facts.set("c1", { setupCompletedAt: new Date(), subscriptionStatus: "active" });
    await ensureTollfreeNumber(deps, "c1"); // "I'm done"
    expect(api.buyNumber).toHaveBeenCalledTimes(1);
    expect(mem.rows.get("c1")).toMatchObject({ status: "needs_details", phoneNumberSid: "PN1" });
    await ensureTollfreeNumber(deps, "c1"); // later subscription.updated
    await ensureTollfreeNumber(deps, "c1"); // "I'm done" again after reopening
    expect(api.buyNumber).toHaveBeenCalledTimes(1);
  });

  it("setup finished before paying: the payment event does the one purchase", async () => {
    mem.facts.set("c1", { subscriptionStatus: null });
    await ensureTollfreeNumber(deps, "c1"); // "I'm done", no card yet
    expect(api.buyNumber).not.toHaveBeenCalled();
    mem.facts.set("c1", { subscriptionStatus: "trialing" });
    await ensureTollfreeNumber(deps, "c1"); // card added
    expect(api.buyNumber).toHaveBeenCalledTimes(1);
  });

  it("concurrent events buy once", async () => {
    await Promise.all([ensureTollfreeNumber(deps, "c1"), ensureTollfreeNumber(deps, "c1"), ensureTollfreeNumber(deps, "c1")]);
    expect(api.buyNumber).toHaveBeenCalledTimes(1);
    expect(mem.locks.size).toBe(0);
  });

  it("a failed purchase releases the claim so a later event can retry", async () => {
    api.buyNumber.mockRejectedValueOnce(new Error("Twilio down"));
    await ensureTollfreeNumber(deps, "c1");
    expect(mem.rows.get("c1")).toMatchObject({ status: "needs_number", lastError: "Twilio down" });
    expect(mem.locks.size).toBe(0);
    await ensureTollfreeNumber(deps, "c1");
    expect(api.buyNumber).toHaveBeenCalledTimes(2);
    expect(mem.rows.get("c1")?.phoneNumberSid).toBe("PN1");
  });

  it.each([
    ["canceled subscription", { subscriptionStatus: "canceled" }],
    ["past_due / unpaid subscription", { subscriptionStatus: "past_due" }],
    ["no subscription", { subscriptionStatus: null }],
    ["churned business", { status: "churned" }],
    ["paused business", { status: "paused" }],
    ["already texts from its own number", { smsNumber: "+15125550100" }],
  ] as const)("skips: %s", async (_label, f) => {
    mem.facts.set("c1", f as Partial<TollfreeClient>);
    if ("smsNumber" in f) mem.smsNumber.set("c1", f.smsNumber);
    await ensureTollfreeNumber(deps, "c1");
    expect(api.buyNumber).not.toHaveBeenCalled();
  });

  it("comped businesses that finished setup get one without a subscription", async () => {
    mem.facts.set("c1", { comped: true, subscriptionStatus: null });
    await ensureTollfreeNumber(deps, "c1");
    expect(api.buyNumber).toHaveBeenCalledTimes(1);
  });

  it("a business that already has a toll-free number keeps it and is never re-bought, even if no longer eligible", async () => {
    await mem.store.save("c1", { status: "submitted", phoneNumber: "+18885550000", phoneNumberSid: "PN0" });
    mem.facts.set("c1", { setupCompletedAt: null, subscriptionStatus: "canceled" });
    const row = await ensureTollfreeNumber(deps, "c1");
    expect(row).toMatchObject({ phoneNumberSid: "PN0", status: "submitted" });
    expect(api.buyNumber).not.toHaveBeenCalled();
  });
});

describe("tollfreePurchaseBlocker", () => {
  const ok = { status: "live", smsNumber: null, setupCompletedAt: new Date(), comped: false, subscriptionStatus: "active" };
  it("allows a paying business that finished setup", () => {
    expect(tollfreePurchaseBlocker(ok)).toBeNull();
    expect(tollfreePurchaseBlocker({ ...ok, subscriptionStatus: "trialing" })).toBeNull();
  });
  it("names why not", () => {
    expect(tollfreePurchaseBlocker({ ...ok, setupCompletedAt: null })).toBe("setup_not_finished");
    expect(tollfreePurchaseBlocker({ ...ok, subscriptionStatus: "incomplete" })).toBe("not_paying");
    expect(tollfreePurchaseBlocker({ ...ok, status: "churned" })).toBe("inactive");
    expect(tollfreePurchaseBlocker({ ...ok, smsNumber: "+15125550100" })).toBe("has_sms_number");
  });
});

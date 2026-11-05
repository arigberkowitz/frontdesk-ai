import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientTollfree } from "@/db/schema";
import type { TollfreeStore } from "@/lib/data/tollfree";
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
  const store: TollfreeStore = {
    async get(id) { return rows.get(id) ?? null; },
    async save(id, patch) {
      const cur = rows.get(id) ?? ({ id: "r-" + id, clientId: id, status: "needs_number", createdAt: new Date(), updatedAt: new Date() } as ClientTollfree);
      rows.set(id, { ...cur, ...patch } as ClientTollfree);
    },
    async byVerificationSid(sid) { return [...rows.values()].find((r) => r.verificationSid === sid) ?? null; },
    async listSubmitted() { return [...rows.values()].filter((r) => r.status === "submitted"); },
    async client(id) { return { id, name: "Bright Smile", smsNumber: smsNumber.get(id) ?? null }; },
    async useAsSmsNumber(id, n) { if (!smsNumber.has(id)) smsNumber.set(id, n); },
  };
  return { store, rows, smsNumber };
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

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Which business an inbound text is attributed to — and what happens when unsure. */

const DENTIST = { id: "c-dentist", ownerEmail: "d@x.test" };
const PLUMBER = { id: "c-plumber", ownerEmail: "p@x.test" };

const byLine = vi.fn();
const lastTexted = vi.fn();
const byId = vi.fn();
const lastMessaged = vi.fn();
const recordInbound = vi.fn();

vi.mock("@/lib/data/clients", () => ({
  findClientByPhone: (...a: unknown[]) => byLine(...a),
  findClientLastTexted: (...a: unknown[]) => lastTexted(...a),
  getClientByIdUnsafe: (...a: unknown[]) => byId(...a),
}));
vi.mock("@/lib/data/sms-messages", () => ({
  findClientLastMessaged: (...a: unknown[]) => lastMessaged(...a),
  recordInboundSms: (...a: unknown[]) => recordInbound(...a),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { resolveInboundClient, storeInboundMessage } = await import("./sms-inbox");

beforeEach(() => {
  for (const f of [byLine, lastTexted, byId, lastMessaged, recordInbound]) f.mockReset();
  byLine.mockResolvedValue(null);
  lastTexted.mockResolvedValue(null);
  lastMessaged.mockResolvedValue(null);
  byId.mockImplementation(async (id: string) => (id === DENTIST.id ? DENTIST : id === PLUMBER.id ? PLUMBER : undefined));
  recordInbound.mockResolvedValue({ stored: true, isNew: true });
});

describe("resolveInboundClient", () => {
  it("prefers the business whose own line was texted (To)", async () => {
    byLine.mockResolvedValue(DENTIST);
    lastMessaged.mockResolvedValue(PLUMBER.id);
    expect(await resolveInboundClient("+16505550000", "+14155550100")).toBe(DENTIST);
    expect(lastMessaged).not.toHaveBeenCalled();
  });

  it("on the shared sending number, falls back to whoever last texted this customer", async () => {
    lastMessaged.mockResolvedValue(PLUMBER.id);
    lastTexted.mockResolvedValue(DENTIST);
    expect(await resolveInboundClient("+18885550000", "+14155550100")).toBe(PLUMBER);
    expect(lastMessaged).toHaveBeenCalledWith("+14155550100");
  });

  it("falls back to the reminders log for texts sent before the inbox existed", async () => {
    lastTexted.mockResolvedValue(DENTIST);
    expect(await resolveInboundClient("+18885550000", "+14155550100")).toBe(DENTIST);
  });

  it("skips a last-messaged business that has since been deleted", async () => {
    lastMessaged.mockResolvedValue("c-deleted");
    lastTexted.mockResolvedValue(DENTIST);
    expect(await resolveInboundClient("", "+14155550100")).toBe(DENTIST);
  });

  it("returns null for a stranger — no business gets a message it wasn't party to", async () => {
    expect(await resolveInboundClient("+18885550000", "+14155550100")).toBeNull();
  });
});

describe("storeInboundMessage", () => {
  it("stores under the resolved business with sid + kind", async () => {
    byLine.mockResolvedValue(DENTIST);
    const r = await storeInboundMessage({ from: "+14155550100", to: "+16505550000", body: "hi", messageSid: "SM1", kind: "reply" });
    expect(r).toEqual({ owner: DENTIST, isNew: true });
    expect(recordInbound).toHaveBeenCalledWith({
      clientId: DENTIST.id,
      from: "+14155550100",
      to: "+16505550000",
      body: "hi",
      providerSid: "SM1",
      kind: "reply",
    });
  });

  it("passes through a replay (isNew false)", async () => {
    byLine.mockResolvedValue(DENTIST);
    recordInbound.mockResolvedValue({ stored: true, isNew: false });
    expect((await storeInboundMessage({ from: "+14155550100", to: "+16505550000", body: "hi", messageSid: "SM1", kind: "reply" })).isNew).toBe(false);
  });

  it("stores nothing when no business can be resolved", async () => {
    const r = await storeInboundMessage({ from: "+14155550100", to: "", body: "hi", messageSid: "SM1", kind: "reply" });
    expect(r.owner).toBeNull();
    expect(recordInbound).not.toHaveBeenCalled();
  });

  it("never throws, even if resolution blows up (it runs in the STOP handler)", async () => {
    byLine.mockRejectedValue(new Error("db down"));
    await expect(
      storeInboundMessage({ from: "+14155550100", to: "+16505550000", body: "STOP", messageSid: "SM1", kind: "opt_out" }),
    ).resolves.toEqual({ owner: null, isNew: true });
  });
});

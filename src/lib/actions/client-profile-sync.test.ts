import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  client: {
    id: "c1",
    orgId: "o1",
    name: "Nick's Barbershop",
    retellAgentId: "ag_1",
    retellPhoneNumber: "+14155550100",
    ownerEmail: "nick@example.com",
    escalationNumber: "+14155550199",
  } as Record<string, unknown>,
  updateClient: vi.fn(async (..._a: unknown[]) => ({})),
  setClientStatus: vi.fn(async (..._a: unknown[]) => ({})),
  assertClientInOrg: vi.fn(async () => m.client),
  applyClientEdit: vi.fn(async (_user: { orgId: string }, _clientId: string): Promise<"synced" | "failed" | "not_provisioned"> => "synced"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireOperator: async () => ({ id: "u1", role: "operator", orgId: "o1" }),
}));
vi.mock("@/lib/data/clients", () => ({
  assertClientInOrg: m.assertClientInOrg,
  updateClient: m.updateClient,
  setClientStatus: m.setClientStatus,
}));
vi.mock("@/lib/agent-publish", async (orig) => {
  const real = await orig<typeof import("@/lib/agent-publish")>();
  return { ...real, applyClientEdit: m.applyClientEdit };
});

const { updateClientProfileAction, setClientStatusAction } = await import("./clients");

beforeEach(() => {
  m.updateClient.mockClear();
  m.setClientStatus.mockClear();
  m.applyClientEdit.mockReset();
  m.applyClientEdit.mockResolvedValue("synced");
  m.assertClientInOrg.mockClear();
  m.assertClientInOrg.mockResolvedValue(m.client);
});

describe("updateClientProfileAction", () => {
  it("republishes after saving name and other prompt fields", async () => {
    const f = new FormData();
    f.set("clientId", "c1");
    f.set("name", "Nick's Cuts");
    f.set("industry", "barbershop");
    f.set("address", "1 Main St");
    f.set("timezone", "America/Los_Angeles");
    f.set("websiteUrl", "");
    f.set("escalationNumber", "+14155550199");
    f.set("forwardingNumber", "");
    f.set("ownerEmail", "nick@example.com");
    const result = await updateClientProfileAction({}, f);
    expect(m.updateClient).toHaveBeenCalled();
    expect(m.applyClientEdit).toHaveBeenCalledWith({ id: "u1", role: "operator", orgId: "o1" }, "c1");
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Saved.");
  });

  it("still saves when the live push fails", async () => {
    m.applyClientEdit.mockResolvedValue("failed");
    const f = new FormData();
    f.set("clientId", "c1");
    f.set("name", "Nick's Cuts");
    f.set("industry", "barbershop");
    f.set("address", "1 Main St");
    f.set("timezone", "America/Los_Angeles");
    f.set("websiteUrl", "");
    f.set("escalationNumber", "+14155550199");
    f.set("forwardingNumber", "");
    f.set("ownerEmail", "nick@example.com");
    const result = await updateClientProfileAction({}, f);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/couldn't update the live receptionist/i);
  });
});

describe("setClientStatusAction", () => {
  it("republishes so a pause reaches the live line", async () => {
    const f = new FormData();
    f.set("clientId", "c1");
    f.set("status", "paused");
    const result = await setClientStatusAction({}, f);
    expect(m.setClientStatus).toHaveBeenCalledWith("o1", "c1", "paused");
    expect(m.applyClientEdit).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Status updated.");
  });
});

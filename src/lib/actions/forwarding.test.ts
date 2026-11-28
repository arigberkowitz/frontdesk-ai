import { beforeEach, describe, expect, it, vi } from "vitest";

/** Who may run "Test my forwarding", and the forwarding on/off switch. */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const guard = { current: { ok: true, user: { id: "u1", orgId: "o1" } } as { ok: boolean; error?: string; user?: { id: string; orgId: string } } };
vi.mock("@/lib/auth-guard", () => ({
  requireClientOwner: async () => guard.current,
  requireClientEditor: async () => guard.current,
}));
vi.mock("@/lib/data/clients", () => ({ assertClientInOrg: async () => ({}) }));
vi.mock("@/lib/data/audit", () => ({ audit: vi.fn() }));
const placeCall = vi.fn(async (..._a: unknown[]) => ({ sid: "CA1" }));
const startSpy = vi.fn();
vi.mock("@/lib/data/forwarding-test", () => ({ forwardingTestDeps: () => ({ placeCall }) }));
vi.mock("@/lib/forwarding-test", async (orig) => ({
  ...(await orig<typeof import("@/lib/forwarding-test")>()),
  startForwardingTest: (...a: unknown[]) => {
    startSpy(...a);
    return { ok: true, test: { id: "t1", mode: "all_calls" }, waitMs: 45000 };
  },
  pollForwardingTest: async () => ({ status: "pending" }),
}));
vi.mock("@/lib/agents/setup-check", () => ({ checkSetupReadiness: vi.fn() }));
vi.mock("@/lib/data/setup", () => ({ getClientSetupStatus: vi.fn() }));
vi.mock("@/lib/data/setup-review", () => ({ markSetupReviewed: vi.fn() }));
vi.mock("@/lib/provision", () => ({ ensureTollfreeNumberSafely: vi.fn() }));

const updates: { set: unknown }[] = [];
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (v: unknown) => {
        updates.push({ set: v });
        return { where: () => ({ returning: async () => [] }) };
      },
    }),
    query: { clients: { findFirst: async () => ({ retellPhoneNumber: "+12272382281", escalationNumber: "+14155550111", forwardingNumber: null }) } },
  },
}));

const { startForwardingTestAction, checkForwardingTestAction, saveBusinessLineAction } = await import("./forwarding");
const { setSetupFlagAction } = await import("./setup");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const sqlText = (x: unknown) => {
  const chunks = (x as { setupFlags?: { queryChunks?: unknown[] } }).setupFlags?.queryChunks ?? [];
  return chunks
    .map((c) => (typeof c === "string" ? c : Array.isArray((c as { value?: unknown }).value) ? ((c as { value: string[] }).value).join("") : "?"))
    .join("");
};

beforeEach(() => {
  guard.current = { ok: true, user: { id: "u1", orgId: "o1" } };
  updates.length = 0;
  startSpy.mockClear();
});

describe("test my forwarding: owner or operator only", () => {
  it("runs for the owner, using only the saved business line (the request carries no number)", async () => {
    const r = await startForwardingTestAction({}, form({ clientId: "c1", phone: "+19995550000" }));
    expect(r.ok).toBe(true);
    expect(startSpy).toHaveBeenCalledWith(expect.anything(), { clientId: "c1", actorId: "u1" });
    expect(JSON.stringify(startSpy.mock.calls[0])).not.toContain("9995550000");
  });

  it("refuses staff and cross-tenant callers, and places nothing", async () => {
    guard.current = { ok: false, error: "Only the business owner can change this." };
    expect(await startForwardingTestAction({}, form({ clientId: "c1" }))).toMatchObject({ ok: false });
    expect(startSpy).not.toHaveBeenCalled();
    expect(await checkForwardingTestAction("c1", "t1")).toBeNull();
    expect(await saveBusinessLineAction({}, form({ clientId: "c1", businessLine: "(415) 555-0100" }))).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });
});

describe("business line", () => {
  it("must be a full number, not the AI's own number, and not the number transfers go to", async () => {
    expect(await saveBusinessLineAction({}, form({ clientId: "c1", businessLine: "555" }))).toMatchObject({ ok: false });
    expect(await saveBusinessLineAction({}, form({ clientId: "c1", businessLine: "(227) 238-2281" }))).toMatchObject({ ok: false });
    expect(await saveBusinessLineAction({}, form({ clientId: "c1", businessLine: "+14155550111" }))).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });
  it("saves a valid number as E.164 and forgets the old verification", async () => {
    const r = await saveBusinessLineAction({}, form({ clientId: "c1", businessLine: "(415) 555-0100" }));
    expect(r.ok).toBe(true);
    const set = updates[0].set as { forwardingNumber: string };
    expect(set.forwardingNumber).toBe("+14155550100");
    expect(sqlText(set)).toContain("forwardingVerifiedAt");
  });
});

describe("forwarding switch (same forwardingDone flag)", () => {
  it("turning it on sets the flag without touching the test state", async () => {
    const r = await setSetupFlagAction({}, form({ clientId: "c1", flag: "forwardingDone", value: "true" }));
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/marked on/i);
    const text = sqlText(updates[0].set);
    expect(text).toContain("jsonb_build_object");
    expect(text).not.toContain("forwardingVerifiedAt");
  });
  it("turning it off clears when it was last verified, and says how to really turn it off", async () => {
    const r = await setSetupFlagAction({}, form({ clientId: "c1", flag: "forwardingDone", value: "false" }));
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/turn-off code/);
    expect(sqlText(updates[0].set)).toContain("forwardingVerifiedAt");
    expect(sqlText(updates[0].set)).toContain("forwardingDone");
  });
  it("staff without edit rights can't flip it", async () => {
    guard.current = { ok: false, error: "No edit access" };
    expect(await setSetupFlagAction({}, form({ clientId: "c1", flag: "forwardingDone", value: "true" }))).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The public intake link: the signed token is the only authorization, so the
 * action must hold input to the portal's limits, never erase working details,
 * not duplicate drafted content, push changes to a live agent, and throttle.
 */

let content = 0;
const updateClient = vi.fn(async (..._a: unknown[]) => {});
const applyWebsiteToClient = vi.fn(async (..._a: unknown[]) => true);
const applyClientEdit = vi.fn(async (..._a: unknown[]) => "synced");

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/intake-token", () => ({ verifyIntakeToken: (t: string) => (t.startsWith("ok-") ? t.slice(3) : null) }));
vi.mock("@/lib/data/clients", () => ({
  getClientByIdUnsafe: async (id: string) => ({
    id,
    orgId: "org1",
    name: "Old",
    websiteUrl: null,
    ownerEmail: "old@biz.test",
    escalationNumber: "+14155550100",
    agentGuidance: "keep",
  }),
  updateClient: (...a: unknown[]) => updateClient(...a),
}));
vi.mock("@/lib/onboarding-apply", () => ({ applyWebsiteToClient: (...a: unknown[]) => applyWebsiteToClient(...a) }));
vi.mock("@/lib/agent-publish", () => ({ applyClientEdit: (...a: unknown[]) => applyClientEdit(...a) }));
vi.mock("@/lib/data/intake", () => ({ countDraftableContent: async () => content }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { submitIntakeAction } = await import("./intake");

let n = 0;
function form(fields: Record<string, string>, token = `ok-client-${n}`) {
  const fd = new FormData();
  fd.set("token", token);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  n += 1; // fresh client id per test → fresh throttle bucket
  content = 0;
  updateClient.mockClear();
  applyWebsiteToClient.mockClear();
  applyClientEdit.mockClear();
});

describe("submitIntakeAction", () => {
  it("rejects a forged/expired token", async () => {
    const r = await submitIntakeAction({}, form({ name: "X" }, "bad"));
    expect(r.ok).toBe(false);
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("caps guidance at the portal's limit and keeps what was typed", async () => {
    const r = await submitIntakeAction({}, form({ name: "Harbor View", instructions: "x".repeat(4001) }));
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.instructions?.[0]).toMatch(/4,000/);
    expect((r.data as { values: Record<string, string> }).values.name).toBe("Harbor View");
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("a mistyped cell is a field error (shown on the field), and nothing is saved", async () => {
    const r = await submitIntakeAction({}, form({ name: "Harbor View", ownerCell: "555" }));
    expect(r.fieldErrors?.ownerCell?.[0]).toMatch(/10-digit/);
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("accepts a bare domain, tidies the name, keeps blank fields unchanged, and republishes", async () => {
    const r = await submitIntakeAction({}, form({ name: "harbor view plumbing", websiteUrl: "harborview.com" }));
    expect(r.ok).toBe(true);
    expect(updateClient).toHaveBeenCalledWith(
      "org1",
      expect.any(String),
      expect.objectContaining({
        name: "Harbor View Plumbing",
        websiteUrl: "https://harborview.com",
        ownerEmail: "old@biz.test",
        escalationNumber: "+14155550100",
        agentGuidance: "keep",
      }),
    );
    expect(applyWebsiteToClient).toHaveBeenCalledTimes(1);
    expect(applyClientEdit).toHaveBeenCalledWith({ orgId: "org1" }, expect.any(String));
  });

  it("doesn't re-draft (and duplicate) services/FAQs a business already has", async () => {
    content = 5;
    const r = await submitIntakeAction({}, form({ name: "Harbor View", websiteUrl: "harborview.com" }));
    expect(r.ok).toBe(true);
    expect(applyWebsiteToClient).not.toHaveBeenCalled();
    expect((r.data as { drafting: boolean }).drafting).toBe(false);
  });

  it("throttles a link that's being hammered", async () => {
    const token = `ok-hammered-${n}`;
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await submitIntakeAction({}, form({ name: "Harbor View" }, token)));
    expect(results.slice(0, 6).every((r) => r.ok)).toBe(true);
    expect(results[6].ok).toBe(false);
    expect(results[6].error).toMatch(/Too many/);
  });
});
